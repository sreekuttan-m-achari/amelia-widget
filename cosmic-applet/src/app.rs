// SPDX-License-Identifier: GPL-2.0-or-later

use cosmic::app::{Core, Task};
use cosmic::iced::platform_specific::shell::wayland::commands::popup::{destroy_popup, get_popup};
use cosmic::iced::widget::container;
use cosmic::iced::widget::scrollable;
use cosmic::iced::{window::Id, Alignment, Background, Border, Color, Length, Limits, Subscription};
use cosmic::theme::{self, Theme};
use cosmic::widget::button::{suggested, text as text_button};
use cosmic::widget::text::{body, caption, caption_heading, heading, text as plain_text};
use cosmic::widget::{column, divider, progress_bar, row, space, text_input};
use cosmic::Action;
use cosmic::Element;
use futures::channel::mpsc::Sender;
use futures::SinkExt;

use crate::api::{
    ensure_server_ready, fetch_health, post_cancel, post_chat, run_ws_loop, ws_send_cancel,
    ws_send_chat, WsInbound,
};

fn app_msg(message: Message) -> Action<Message> {
    Action::App(message)
}

const POPUP_WIDTH: f32 = 480.0;
const POPUP_HEIGHT: f32 = 560.0;
const POPUP_PADDING: f32 = 12.0;
const HEALTH_POLL_SECS: u64 = 5;
const CHAT_SCROLL_ID: &str = "amelia-chat-scroll";

fn popup_limits() -> Limits {
    Limits::NONE
        .min_width(POPUP_WIDTH)
        .max_width(POPUP_WIDTH)
        .min_height(POPUP_HEIGHT)
        .max_height(POPUP_HEIGHT)
}

fn scroll_chat_to_end() -> Task<Message> {
    cosmic::iced::widget::scrollable::snap_to(
        cosmic::iced::widget::Id::new(CHAT_SCROLL_ID),
        cosmic::iced::widget::scrollable::RelativeOffset::END.into(),
    )
}

fn with_scroll(task: Task<Message>) -> Task<Message> {
    Task::batch([task, scroll_chat_to_end()])
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Role {
    User,
    Assistant,
    System,
}

#[derive(Debug, Clone)]
struct ChatMessage {
    role: Role,
    text: String,
    pending: bool,
}

#[derive(Default)]
pub struct AmeliaApplet {
    core: Core,
    popup: Option<Id>,
    messages: Vec<ChatMessage>,
    compose: String,
    busy: bool,
    connecting: bool,
    connection_failed: bool,
    server_ready: bool,
    agent_warm: bool,
    ws_connected: bool,
    has_user_chatted: bool,
    pending_id: String,
    streaming_reply: String,
    last_query: String,
    can_resume: bool,
    server_version: String,
    server_start_attempted: bool,
    typing_phase: u8,
    ws_cmd_tx: Option<tokio::sync::mpsc::UnboundedSender<String>>,
}

#[derive(Debug, Clone)]
pub enum Message {
    TogglePopup,
    PopupClosed(Id),
    HealthTick,
    HealthResult(Result<crate::api::Health, String>),
    BootstrapServer,
    BootstrapResult {
        health: Result<crate::api::Health, String>,
        start_attempted: bool,
    },
    WsEvent(WsInbound),
    WsCmdSender(tokio::sync::mpsc::UnboundedSender<String>),
    InputChanged(String),
    Send,
    Cancel,
    Resume,
    Retry,
    TypingTick,
    ChatHttpResult {
        id: String,
        result: Result<crate::api::ChatResponse, String>,
    },
}

fn user_bubble_style(theme: &Theme) -> container::Style {
    let cosmic = theme.cosmic();
    let accent: Color = cosmic.accent.base.into();
    container::Style {
        text_color: Some(cosmic.on_bg_color().into()),
        icon_color: Some(cosmic.on_bg_color().into()),
        background: Some(Background::Color(Color {
            a: 0.32,
            ..accent
        })),
        border: Border {
            radius: cosmic.radius_s().into(),
            width: 1.0,
            color: accent,
        },
        ..Default::default()
    }
}

fn assistant_bubble_style(theme: &Theme) -> container::Style {
    let cosmic = theme.cosmic();
    container::Style {
        text_color: Some(cosmic.on_secondary_container_color().into()),
        icon_color: Some(cosmic.on_secondary_container_color().into()),
        background: Some(Background::Color(cosmic.secondary_container_color().into())),
        border: Border {
            radius: cosmic.radius_s().into(),
            width: 1.0,
            color: cosmic.secondary_container_divider().into(),
        },
        ..Default::default()
    }
}

fn system_bubble_style(theme: &Theme) -> container::Style {
    let cosmic = theme.cosmic();
    container::Style {
        text_color: Some(cosmic.on_bg_component_color().into()),
        icon_color: Some(cosmic.on_bg_component_color().into()),
        background: Some(Background::Color(cosmic.bg_component_color().into())),
        border: Border {
            radius: cosmic.radius_s().into(),
            width: 1.0,
            color: cosmic.bg_component_divider().into(),
        },
        ..Default::default()
    }
}

impl AmeliaApplet {
    const APP_ID: &'static str = "com.amelia.CosmicApplet";

    fn status_text(&self) -> &'static str {
        if self.connecting {
            "checking…"
        } else if self.connection_failed || !self.server_ready {
            "offline"
        } else if !self.agent_warm {
            "warming…"
        } else if self.busy {
            "thinking…"
        } else {
            "online"
        }
    }

    fn status_is_positive(&self) -> bool {
        self.server_ready && self.agent_warm && !self.connection_failed
    }

    fn typing_dots(&self) -> &'static str {
        match self.typing_phase % 4 {
            0 => "",
            1 => ".",
            2 => "..",
            _ => "...",
        }
    }

    fn show_typing_animation(&self) -> bool {
        self.busy
            || self.connecting
            || (self.server_ready && !self.agent_warm)
    }

    fn status_badge(&self) -> Element<'_, Message> {
        let label = self.status_text();
        let positive = self.status_is_positive();
        let accent = theme::active().cosmic().accent_color().into();
        let offline = theme::active().cosmic().destructive_color().into();
        let muted = theme::active().cosmic().on_bg_component_color().into();
        let dot_color = if self.connection_failed {
            offline
        } else if positive {
            accent
        } else {
            muted
        };
        let text_class = if self.connection_failed {
            theme::Text::Color(offline)
        } else if positive {
            theme::Text::Accent
        } else {
            theme::Text::Default
        };

        let dot = container(plain_text(""))
            .width(8)
            .height(8)
            .class(theme::Container::custom(move |_| container::Style {
                background: Some(Background::Color(dot_color)),
                border: Border {
                    radius: 4.0.into(),
                    width: 0.0,
                    color: dot_color,
                },
                ..Default::default()
            }));

        row![dot, caption(label).class(text_class)]
            .spacing(6)
            .align_y(Alignment::Center)
            .into()
    }

    fn can_chat(&self) -> bool {
        self.server_ready && self.agent_warm && !self.busy
    }

    fn clear_messages(&mut self) {
        self.messages.clear();
    }

    fn add_message(&mut self, role: Role, text: impl Into<String>, pending: bool) {
        self.messages.push(ChatMessage {
            role,
            text: text.into(),
            pending,
        });
    }

    fn set_greeting(&mut self, greeting: &str) {
        if greeting.is_empty() {
            return;
        }
        self.agent_warm = true;
        if !self.has_user_chatted && !self.busy {
            self.clear_messages();
            self.add_message(Role::Assistant, greeting, false);
        }
    }

    fn apply_health(&mut self, health: &crate::api::Health) {
        if let Some(greeting) = health.greeting.as_deref() {
            self.set_greeting(greeting);
        } else if health.warm {
            self.agent_warm = true;
        }
    }

    fn apply_health_ok(&mut self, health: &crate::api::Health) {
        self.connection_failed = false;
        self.server_ready = true;
        self.connecting = false;
        if !health.version.is_empty() {
            self.server_version = health.version.clone();
        }
        self.apply_health(health);
    }

    fn apply_health_offline(&mut self) {
        self.connection_failed = true;
        self.server_ready = false;
        self.agent_warm = false;
    }

    fn on_backend_connected(&mut self, health: crate::api::Health) {
        self.apply_health_ok(&health);
        if !self.agent_warm && !self.busy && !self.has_user_chatted {
            self.clear_messages();
        }
    }

    fn on_backend_failed(&mut self) {
        self.connecting = false;
        self.connection_failed = true;
        self.server_ready = false;
        self.clear_messages();
        self.add_message(
            Role::System,
            format!(
                "Self-check: backend is down.\n\n\
                 ✗ No response from {}\n\n\
                 The applet tried to start it automatically.\n\
                 You can also run:\n\
                   systemctl --user start amelia-widget\n\n\
                 Check logs:\n\
                   journalctl --user -u amelia-widget -f\n\n\
                 Tap Retry to try again.",
                crate::api::api_base()
            ),
            false,
        );
    }

    fn update_pending_assistant(&mut self, text: impl Into<String>) {
        let text = text.into();
        if let Some(message) = self
            .messages
            .iter_mut()
            .rev()
            .find(|message| message.role == Role::Assistant && message.pending)
        {
            message.text = text;
            return;
        }
        self.add_message(Role::Assistant, text, true);
    }

    fn finalize_pending_assistant(&mut self, text: impl Into<String>) {
        let text = text.into();
        if let Some(message) = self
            .messages
            .iter_mut()
            .rev()
            .find(|message| message.role == Role::Assistant && message.pending)
        {
            message.text = text;
            message.pending = false;
            return;
        }
        self.add_message(Role::Assistant, text, false);
    }

    fn on_query_cancelled(&mut self, partial: &str) {
        self.busy = false;
        self.can_resume = !self.last_query.is_empty();
        let stopped = if partial.is_empty() {
            "Stopped.".to_string()
        } else {
            format!("{partial}\n\n— Stopped.")
        };
        self.finalize_pending_assistant(stopped);
        self.streaming_reply.clear();
        self.pending_id.clear();
    }

    fn handle_ws(&mut self, event: WsInbound) -> Task<Message> {
        let mut scroll = false;
        match event {
            WsInbound::Ready { greeting, warm } => {
                self.ws_connected = true;
                if let Some(greeting) = greeting {
                    self.set_greeting(&greeting);
                    scroll = true;
                } else if warm {
                    self.agent_warm = true;
                }
            }
            WsInbound::Greeting(text) => {
                self.set_greeting(&text);
                scroll = true;
            }
            WsInbound::Chunk { id, text } => {
                if id == self.pending_id {
                    self.streaming_reply.push_str(&text);
                    let streaming = self.streaming_reply.clone();
                    self.update_pending_assistant(streaming);
                    scroll = true;
                }
            }
            WsInbound::Done { id, reply } => {
                if id == self.pending_id {
                    self.busy = false;
                    self.can_resume = false;
                    let final_reply = if reply.is_empty() {
                        if self.streaming_reply.is_empty() {
                            "(empty reply)".to_string()
                        } else {
                            self.streaming_reply.clone()
                        }
                    } else {
                        reply
                    };
                    self.finalize_pending_assistant(final_reply);
                    self.streaming_reply.clear();
                    self.pending_id.clear();
                    scroll = true;
                }
            }
            WsInbound::Cancelled { id, reply } => {
                if id == self.pending_id {
                    let partial = reply.unwrap_or_else(|| self.streaming_reply.clone());
                    self.on_query_cancelled(&partial);
                    scroll = true;
                }
            }
            WsInbound::Error { id, error } => {
                if id.as_deref() == Some(self.pending_id.as_str()) || id.is_none() {
                    self.busy = false;
                    self.can_resume = !self.last_query.is_empty();
                    self.finalize_pending_assistant(error);
                    self.streaming_reply.clear();
                    self.pending_id.clear();
                    scroll = true;
                }
            }
            WsInbound::Disconnected => {
                self.ws_connected = false;
            }
        }
        if scroll {
            scroll_chat_to_end()
        } else {
            Task::none()
        }
    }

    fn send_message(&mut self, text: String) -> Task<Message> {
        if text.is_empty() || self.busy || !self.can_chat() {
            return Task::none();
        }

        self.busy = true;
        self.has_user_chatted = true;
        self.can_resume = false;
        self.last_query = text.clone();
        self.streaming_reply.clear();
        self.pending_id = format!(
            "{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0)
        );
        self.compose.clear();
        self.add_message(Role::User, text.clone(), false);
        self.add_message(Role::Assistant, String::new(), true);

        if self.ws_connected {
            if let Some(tx) = self.ws_cmd_tx.clone() {
                let id = self.pending_id.clone();
                return with_scroll(Task::future(async move {
                    let _ = ws_send_chat(&tx, &id, &text).await;
                    app_msg(Message::HealthTick)
                }));
            }
        }

        let id = self.pending_id.clone();
        with_scroll(Task::perform(post_chat(text, id.clone()), move |result| {
            app_msg(Message::ChatHttpResult { id, result })
        }))
    }

    fn message_bubble<'a>(&self, message: &'a ChatMessage) -> Element<'a, Message> {
        let is_pending = message.pending && message.text.is_empty();

        let label = match message.role {
            Role::User => "You",
            Role::Assistant => "Amelia",
            Role::System => "System",
        };

        let bubble_body: Element<'a, Message> = if is_pending {
            row![
                progress_bar::indeterminate_circular()
                    .size(16.0)
                    .bar_height(2.0),
                caption(format!("Thinking{}", self.typing_dots()))
                    .class(theme::Text::Accent),
            ]
            .spacing(8)
            .align_y(Alignment::Center)
            .into()
        } else {
            body(message.text.as_str()).into()
        };

        let bubble = container(
            column![
                caption_heading(label).class(match message.role {
                    Role::User => theme::Text::Accent,
                    Role::Assistant => theme::Text::Default,
                    Role::System => theme::Text::Default,
                }),
                bubble_body,
            ]
            .spacing(6),
        )
        .padding([8, 10])
        .width(Length::FillPortion(if message.role == Role::System {
            10
        } else {
            9
        }))
        .class(match message.role {
            Role::User => theme::Container::custom(user_bubble_style),
            Role::Assistant => theme::Container::custom(assistant_bubble_style),
            Role::System => theme::Container::custom(system_bubble_style),
        });

        let row_content = match message.role {
            Role::User => row![space::horizontal(), bubble],
            Role::Assistant => row![bubble, space::horizontal()],
            Role::System => row![space::horizontal(), bubble, space::horizontal()],
        };

        column![row_content].into()
    }
}

impl cosmic::Application for AmeliaApplet {
    type Executor = cosmic::executor::Default;
    type Flags = ();
    type Message = Message;

    const APP_ID: &'static str = Self::APP_ID;

    fn core(&self) -> &Core {
        &self.core
    }

    fn core_mut(&mut self) -> &mut Core {
        &mut self.core
    }

    fn init(core: Core, _flags: Self::Flags) -> (Self, Task<Self::Message>) {
        (
            Self {
                core,
                connecting: true,
                ..Default::default()
            },
            Task::batch([
                Task::done(app_msg(Message::BootstrapServer)),
                Task::done(app_msg(Message::HealthTick)),
            ]),
        )
    }

    fn on_close_requested(&self, id: Id) -> Option<Self::Message> {
        Some(Message::PopupClosed(id))
    }

    fn subscription(&self) -> Subscription<Self::Message> {
        let health_poll = Subscription::run(|| {
            cosmic::iced::stream::channel(8, |mut sender: Sender<Message>| async move {
                loop {
                    let _ = sender.send(Message::HealthTick).await;
                    tokio::time::sleep(std::time::Duration::from_secs(HEALTH_POLL_SECS)).await;
                }
            })
        });

        let ws_events = Subscription::run(|| {
            cosmic::iced::stream::channel(64, |mut sender: Sender<Message>| async move {
                let (event_tx, mut event_rx) = tokio::sync::mpsc::unbounded_channel();
                let (cmd_tx, cmd_rx) = tokio::sync::mpsc::unbounded_channel();
                let _ = sender.send(Message::WsCmdSender(cmd_tx)).await;

                tokio::spawn(run_ws_loop(event_tx, cmd_rx));

                while let Some(event) = event_rx.recv().await {
                    if sender.send(Message::WsEvent(event)).await.is_err() {
                        break;
                    }
                }
                futures::future::pending::<()>().await;
            })
        });

        let typing_poll = if self.show_typing_animation() {
            Subscription::run(|| {
                cosmic::iced::stream::channel(4, |mut sender: Sender<Message>| async move {
                    loop {
                        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
                        let _ = sender.send(Message::TypingTick).await;
                    }
                })
            })
        } else {
            Subscription::none()
        };

        Subscription::batch(vec![health_poll, ws_events, typing_poll])
    }

    fn view(&self) -> Element<'_, Self::Message> {
        self.core
            .applet
            .icon_button("user-available-symbolic")
            .on_press(Message::TogglePopup)
            .into()
    }

    fn view_window(&self, id: Id) -> Element<'_, Self::Message> {
        if self.popup != Some(id) {
            return plain_text("").into();
        }

        let header = row![
            heading("Amelia").width(Length::Fill),
            self.status_badge(),
        ]
        .align_y(Alignment::Center)
        .spacing(8);

        let messages = scrollable(
            column(
                self.messages
                    .iter()
                    .map(|message| self.message_bubble(message))
                    .collect::<Vec<_>>(),
            )
            .spacing(10)
            .width(Length::Fill),
        )
        .id(cosmic::iced::widget::Id::new(CHAT_SCROLL_ID))
        .height(Length::Fill);

        let input = text_input("Ask Amelia…", &self.compose)
            .on_input(Message::InputChanged)
            .on_submit(|_| Message::Send)
            .padding(8)
            .width(Length::Fill);

        let mut actions = row![].spacing(8);
        if self.busy {
            actions = actions.push(text_button("Cancel").on_press(Message::Cancel));
        } else if self.can_resume {
            actions = actions.push(text_button("Resume").on_press(Message::Resume));
        }
        if self.connection_failed {
            actions = actions.push(text_button("Retry").on_press(Message::Retry));
        }

        let send_row = row![
            input,
            suggested("Send").on_press_maybe(
                (self.can_chat() && !self.compose.trim().is_empty()).then_some(Message::Send),
            ),
        ]
        .spacing(8)
        .align_y(Alignment::Center);

        let footer = column![actions, send_row].spacing(8);

        let inner_height = POPUP_HEIGHT - POPUP_PADDING * 2.0;
        let body = column![
            header,
            divider::horizontal::default(),
            messages,
            footer,
        ]
        .spacing(10)
        .width(Length::Fill)
        .height(Length::Fixed(inner_height));

        let content = container(body.padding(POPUP_PADDING))
            .width(Length::Fixed(POPUP_WIDTH))
            .height(Length::Fixed(POPUP_HEIGHT));

        self.core
            .applet
            .popup_container(content)
            .limits(popup_limits())
            .auto_width(false)
            .auto_height(false)
            .into()
    }

    fn update(&mut self, message: Self::Message) -> Task<Self::Message> {
        match message {
            Message::TogglePopup => {
                return if let Some(popup) = self.popup.take() {
                    destroy_popup(popup)
                } else {
                    let new_id = Id::unique();
                    self.popup = Some(new_id);
                    let mut popup_settings = self.core.applet.get_popup_settings(
                        self.core.main_window_id().unwrap(),
                        new_id,
                        Some((POPUP_WIDTH as u32, POPUP_HEIGHT as u32)),
                        None,
                        None,
                    );
                    popup_settings.positioner.size_limits = popup_limits();
                    return Task::batch([
                        get_popup(popup_settings),
                        scroll_chat_to_end(),
                    ]);
                };
            }
            Message::PopupClosed(id) => {
                if self.popup == Some(id) {
                    self.popup = None;
                }
            }
            Message::TypingTick => {
                if self.show_typing_animation() {
                    self.typing_phase = self.typing_phase.wrapping_add(1);
                    if self.busy {
                        return scroll_chat_to_end();
                    }
                }
            }
            Message::BootstrapServer => {
                let attempted = self.server_start_attempted;
                return Task::perform(
                    ensure_server_ready(attempted),
                    |(health, start_attempted)| {
                        app_msg(Message::BootstrapResult {
                            health,
                            start_attempted,
                        })
                    },
                );
            }
            Message::BootstrapResult {
                health,
                start_attempted,
            } => {
                self.server_start_attempted = start_attempted;
                let mut scroll = false;
                match health {
                    Ok(health) if health.ok => {
                        self.on_backend_connected(health);
                        scroll = true;
                    }
                    Ok(_) => {
                        self.on_backend_failed();
                        scroll = true;
                    }
                    Err(_) => {
                        self.on_backend_failed();
                        scroll = true;
                    }
                }
                if scroll {
                    return scroll_chat_to_end();
                }
            }
            Message::HealthTick => {
                return Task::perform(fetch_health(), |result| {
                    app_msg(Message::HealthResult(result))
                });
            }
            Message::HealthResult(result) => {
                let message_count = self.messages.len();
                match result {
                    Ok(health) if health.ok => self.apply_health_ok(&health),
                    Ok(_) => self.apply_health_offline(),
                    Err(_) => self.apply_health_offline(),
                }
                if self.messages.len() > message_count {
                    return scroll_chat_to_end();
                }
            }
            Message::WsCmdSender(tx) => {
                self.ws_cmd_tx = Some(tx);
            }
            Message::WsEvent(event) => {
                return self.handle_ws(event);
            }
            Message::InputChanged(value) => {
                self.compose = value;
            }
            Message::Send => {
                let text = self.compose.clone();
                return self.send_message(text);
            }
            Message::Cancel => {
                if self.busy && !self.pending_id.is_empty() {
                    let id = self.pending_id.clone();
                    if self.ws_connected {
                        if let Some(tx) = self.ws_cmd_tx.clone() {
                            return Task::future(async move {
                                let _ = ws_send_cancel(&tx, &id).await;
                                app_msg(Message::HealthTick)
                            });
                        }
                    }
                    return Task::perform(post_cancel(id), |_| app_msg(Message::HealthTick));
                }
            }
            Message::Resume => {
                if !self.busy && self.can_resume && !self.last_query.is_empty() {
                    let text = self.last_query.clone();
                    return self.send_message(text);
                }
            }
            Message::Retry => {
                self.connecting = true;
                self.connection_failed = false;
                self.server_ready = false;
                self.ws_connected = false;
                self.agent_warm = false;
                self.has_user_chatted = false;
                self.server_start_attempted = false;
                self.clear_messages();
                return Task::done(app_msg(Message::BootstrapServer));
            }
            Message::ChatHttpResult { id, result } => {
                if id != self.pending_id {
                    return Task::none();
                }
                self.busy = false;
                match result {
                    Ok(response) => {
                        if response.cancelled {
                            self.on_query_cancelled(&response.reply);
                        } else {
                            self.can_resume = false;
                            self.finalize_pending_assistant(if response.reply.is_empty() {
                                "(empty reply)".to_string()
                            } else {
                                response.reply
                            });
                            self.pending_id.clear();
                            self.streaming_reply.clear();
                        }
                    }
                    Err(err) => {
                        self.can_resume = !self.last_query.is_empty();
                        self.finalize_pending_assistant(err);
                        self.pending_id.clear();
                        self.streaming_reply.clear();
                    }
                }
                return scroll_chat_to_end();
            }
        }
        Task::none()
    }

    fn style(&self) -> Option<cosmic::iced::theme::Style> {
        Some(cosmic::applet::style())
    }
}
