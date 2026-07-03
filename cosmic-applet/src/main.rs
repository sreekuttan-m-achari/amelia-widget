// SPDX-License-Identifier: GPL-2.0-or-later

mod api;
mod app;

fn main() -> cosmic::iced::Result {
    cosmic::applet::run::<app::AmeliaApplet>(())
}
