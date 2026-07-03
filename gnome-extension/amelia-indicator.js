import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {
    apiBase,
    connectWebSocket,
    fetchHealth,
    postCancel,
    postChat,
    startServerViaSystemd,
    wsSend,
} from './api.js';
import { notifyReply, notifyStatus } from './notify.js';

const HEALTH_POLL_SECS = 5;
const POPUP_WIDTH = 480;
const SCROLL_HEIGHT = 390;

export const AmeliaIndicator = GObject.registerClass(
class AmeliaIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'Amelia');

        this._extension = extension;
        this._messages = [];
        this._compose = '';
        this._busy = false;
        this._connecting = true;
        this._connectionFailed = false;
        this._serverReady = false;
        this._agentWarm = false;
        this._ws = null;
        this._wsConnected = false;
        this._hasUserChatted = false;
        this._pendingId = '';
        this._streamingReply = '';
        this._lastQuery = '';
        this._canResume = false;
        this._serverStartAttempted = false;
        this._typingPhase = 0;
        this._lastStatusNotify = null;

        const icon = new St.Icon({
            icon_name: 'user-available-symbolic',
            style_class: 'system-status-icon',
        });
        this.add_child(icon);

        this._buildPopup();
        this._bootstrap();
        this._connectWs();

        this._healthTimer = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            HEALTH_POLL_SECS,
            () => {
                this._pollHealth();
                return GLib.SOURCE_CONTINUE;
            },
        );
        this._typingTimer = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            1,
            () => {
                if (this._busy || this._connecting || (this._serverReady && !this._agentWarm))
                    this._updateStatusLabel();
                return GLib.SOURCE_CONTINUE;
            },
        );
    }

    _buildPopup() {
        this.menu.box.add_style_class_name('amelia-menu-box');

        const shell = new St.BoxLayout({
            vertical: true,
            style_class: 'amelia-shell',
        });
        shell.width = POPUP_WIDTH;

        const header = new St.BoxLayout({ style_class: 'amelia-header' });
        const title = new St.Label({
            text: 'Amelia',
            style_class: 'amelia-title',
            y_align: Clutter.ActorAlign.CENTER,
        });
        title.clutter_text.ellipsize = 0;
        title.clutter_text.x_expand = true;

        this._statusDot = new St.Widget({ style_class: 'amelia-status-dot offline' });
        this._statusLabel = new St.Label({
            text: 'checking…',
            style_class: 'amelia-status-label',
            y_align: Clutter.ActorAlign.CENTER,
        });

        header.add_child(title);
        header.add_child(this._statusDot);
        header.add_child(this._statusLabel);

        const divider = new St.Widget({ style_class: 'popup-separator-menu-item' });
        divider.height = 1;

        this._scroll = new St.ScrollView({
            style_class: 'amelia-scroll vfade',
            overlay_scrollbars: true,
            x_expand: true,
        });
        this._scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        this._scroll.height = SCROLL_HEIGHT;

        this._messageBox = new St.BoxLayout({ vertical: true, style_class: 'amelia-messages' });
        this._scroll.add_actor(this._messageBox);

        this._actionsRow = new St.BoxLayout({ style_class: 'amelia-actions' });

        this._cancelBtn = new St.Button({
            style_class: 'amelia-text-button',
            child: new St.Label({ text: 'Cancel', y_align: Clutter.ActorAlign.CENTER }),
            visible: false,
        });
        this._cancelBtn.connect('clicked', () => this._onCancel());
        this._actionsRow.add_child(this._cancelBtn);

        this._resumeBtn = new St.Button({
            style_class: 'amelia-text-button',
            child: new St.Label({ text: 'Resume', y_align: Clutter.ActorAlign.CENTER }),
            visible: false,
        });
        this._resumeBtn.connect('clicked', () => this._onResume());
        this._actionsRow.add_child(this._resumeBtn);

        this._retryBtn = new St.Button({
            style_class: 'amelia-text-button',
            child: new St.Label({ text: 'Retry', y_align: Clutter.ActorAlign.CENTER }),
            visible: false,
        });
        this._retryBtn.connect('clicked', () => this._bootstrap());
        this._actionsRow.add_child(this._retryBtn);

        const inputRow = new St.BoxLayout({ style_class: 'amelia-input-row' });
        this._entry = new St.Entry({
            hint_text: 'Ask Amelia…',
            can_focus: true,
            x_expand: true,
            style_class: 'amelia-entry',
        });
        this._entry.clutter_text.connect('text-changed', (_t, value) => {
            this._compose = value;
            this._updateSendButton();
        });
        this._entry.clutter_text.connect('activate', () => this._onSend());

        this._sendBtn = new St.Button({
            style_class: 'amelia-send-button',
            child: new St.Label({ text: 'Send', y_align: Clutter.ActorAlign.CENTER }),
            can_focus: true,
        });
        this._sendBtn.connect('clicked', () => this._onSend());

        inputRow.add_child(this._entry);
        inputRow.add_child(this._sendBtn);

        shell.add_child(header);
        shell.add_child(divider);
        shell.add_child(this._scroll);
        shell.add_child(this._actionsRow);
        shell.add_child(inputRow);

        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'amelia-popup-item',
        });
        item.actor.add_child(shell);
        this.menu.addMenuItem(item);
    }

    _bootstrap() {
        this._connecting = true;
        this._connectionFailed = false;
        this._updateStatusLabel();

        if (!this._serverStartAttempted) {
            startServerViaSystemd();
            this._serverStartAttempted = true;
        }

        this._pollHealth(true);
    }

    _statusNotifyKey() {
        if (this._connectionFailed || !this._serverReady)
            return 'offline';
        if (!this._agentWarm)
            return 'warming';
        return 'online';
    }

    _shouldNotifyUser() {
        return !this.menu.isOpen;
    }

    _maybeNotifyReply(text) {
        if (!this._shouldNotifyUser() || !text || !text.trim())
            return;
        notifyReply(text);
    }

    _syncStatusNotifications() {
        if (this._connecting)
            return;
        const key = this._statusNotifyKey();
        const previous = this._lastStatusNotify;
        this._lastStatusNotify = key;
        if (previous === key)
            return;
        if (key === 'offline' && previous !== 'offline')
            notifyStatus('Amelia offline', 'Cannot reach the backend API.');
        else if (key === 'online' && (previous === 'offline' || previous === 'warming'))
            notifyStatus('Amelia online', 'Backend is ready.');
    }

    _applyHealthOk(health) {
        this._connectionFailed = false;
        this._serverReady = true;
        this._connecting = false;
        if (health.warm)
            this._agentWarm = true;
        if (health.greeting)
            this._setGreeting(health.greeting);
        else if (health.warm)
            this._agentWarm = true;
        this._syncStatusNotifications();
    }

    _applyHealthOffline() {
        this._connectionFailed = true;
        this._serverReady = false;
        this._agentWarm = false;
        this._syncStatusNotifications();
    }

    _pollHealth(isBootstrap = false) {
        fetchHealth((err, health) => {
            if (!err && health?.ok) {
                this._applyHealthOk(health);
            } else if (isBootstrap) {
                this._onBackendFailed();
            } else {
                this._applyHealthOffline();
            }
            this._updateStatusLabel();
            this._updateActions();
        });
    }

    _onBackendFailed() {
        this._connecting = false;
        this._connectionFailed = true;
        this._serverReady = false;
        this._clearMessages();
        this._syncStatusNotifications();
        this._addMessage('system', `Self-check: backend is down.\n\n✗ No response from ${apiBase()}\n\nThe extension tried to start it automatically:\n  systemctl --user start amelia-widget\n\nCheck logs:\n  journalctl --user -u amelia-widget -f\n\nTap Retry to try again.`, false);
        this._renderMessages();
    }

    _connectWs() {
        connectWebSocket({
            onOpen: (ws) => {
                this._ws = ws;
                this._wsConnected = true;
            },
            onMessage: (msg) => this._handleWs(msg),
            onClose: () => {
                this._ws = null;
                this._wsConnected = false;
            },
            onError: () => {
                this._ws = null;
                this._wsConnected = false;
            },
        });
    }

    _handleWs(msg) {
        switch (msg.type) {
        case 'ready':
            if (msg.greeting)
                this._setGreeting(msg.greeting);
            else if (msg.warm)
                this._agentWarm = true;
            break;
        case 'greeting':
            this._setGreeting(msg.text);
            break;
        case 'chunk':
            if (msg.id === this._pendingId) {
                this._streamingReply += msg.text;
                this._updatePendingAssistant(this._streamingReply);
            }
            break;
        case 'done':
            if (msg.id === this._pendingId) {
                this._busy = false;
                this._canResume = false;
                const reply = msg.reply || this._streamingReply || '(empty reply)';
                this._maybeNotifyReply(reply);
                this._finalizePendingAssistant(reply);
                this._pendingId = '';
                this._streamingReply = '';
                this._updateActions();
                this._updateStatusLabel();
            }
            break;
        case 'cancelled':
            if (msg.id === this._pendingId)
                this._onQueryCancelled(msg.reply || this._streamingReply);
            break;
        case 'error':
            if (!msg.id || msg.id === this._pendingId) {
                this._busy = false;
                this._canResume = this._lastQuery.length > 0;
                const error = msg.error || 'Error';
                this._maybeNotifyReply(error);
                this._finalizePendingAssistant(error);
                this._pendingId = '';
                this._streamingReply = '';
                this._updateActions();
                this._updateStatusLabel();
            }
            break;
        default:
            break;
        }
    }

    _statusText() {
        if (this._connecting)
            return 'checking…';
        if (this._connectionFailed || !this._serverReady)
            return 'offline';
        if (!this._agentWarm)
            return 'warming…';
        if (this._busy)
            return 'thinking…';
        return 'online';
    }

    _statusPositive() {
        return this._serverReady && this._agentWarm && !this._connectionFailed;
    }

    _typingDots() {
        const phase = this._typingPhase++ % 4;
        return ['', '.', '..', '...'][phase];
    }

    _updateStatusLabel() {
        const text = this._statusText();
        this._statusLabel.text = text;

        this._statusDot.remove_style_class_name('online');
        this._statusDot.remove_style_class_name('offline');
        this._statusDot.remove_style_class_name('muted');
        if (this._connectionFailed || !this._serverReady)
            this._statusDot.add_style_class_name('offline');
        else if (this._statusPositive())
            this._statusDot.add_style_class_name('online');
        else
            this._statusDot.add_style_class_name('muted');
    }

    _canChat() {
        return this._serverReady && this._agentWarm && !this._busy;
    }

    _updateSendButton() {
        const enabled = this._canChat() && this._compose.trim().length > 0;
        this._sendBtn.reactive = enabled;
        this._sendBtn.can_focus = enabled;
        this._sendBtn.opacity = enabled ? 255 : 128;
    }

    _updateActions() {
        this._cancelBtn.visible = this._busy;
        this._resumeBtn.visible = !this._busy && this._canResume;
        this._retryBtn.visible = this._connectionFailed;
        this._updateSendButton();
    }

    _clearMessages() {
        this._messages = [];
    }

    _addMessage(role, text, pending) {
        this._messages.push({ role, text, pending });
    }

    _setGreeting(greeting) {
        if (!greeting)
            return;
        this._agentWarm = true;
        if (!this._hasUserChatted && !this._busy) {
            this._clearMessages();
            this._addMessage('assistant', greeting, false);
            this._renderMessages();
        }
    }

    _updatePendingAssistant(text) {
        for (let i = this._messages.length - 1; i >= 0; i--) {
            if (this._messages[i].role === 'assistant' && this._messages[i].pending) {
                this._messages[i].text = text;
                this._renderMessages();
                return;
            }
        }
        this._addMessage('assistant', text, true);
        this._renderMessages();
    }

    _finalizePendingAssistant(text) {
        for (let i = this._messages.length - 1; i >= 0; i--) {
            if (this._messages[i].role === 'assistant' && this._messages[i].pending) {
                this._messages[i].text = text;
                this._messages[i].pending = false;
                this._renderMessages();
                return;
            }
        }
        this._addMessage('assistant', text, false);
        this._renderMessages();
    }

    _onQueryCancelled(partial) {
        this._busy = false;
        this._canResume = this._lastQuery.length > 0;
        const stopped = partial ? `${partial}\n\n— Stopped.` : 'Stopped.';
        this._finalizePendingAssistant(stopped);
        this._pendingId = '';
        this._streamingReply = '';
        this._updateActions();
        this._updateStatusLabel();
    }

    _renderMessages() {
        this._messageBox.destroy_all_children();

        for (const message of this._messages) {
            const bubble = this._createBubble(message);
            this._messageBox.add_child(bubble);
        }

        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            const vadjust = this._scroll.vscroll.adjustment;
            vadjust.value = vadjust.upper - vadjust.page_size;
            return GLib.SOURCE_REMOVE;
        });
    }

    _createBubble(message) {
        const row = new St.BoxLayout({
            vertical: false,
            style_class: 'amelia-bubble-row',
            x_expand: true,
        });

        const isUser = message.role === 'user';
        const isSystem = message.role === 'system';
        const isPending = message.pending && !message.text;

        if (!isUser && !isSystem)
            row.add_child(new St.Widget({ x_expand: true }));

        const bubble = new St.BoxLayout({
            vertical: true,
            style_class: isUser
                ? 'amelia-bubble amelia-bubble-user'
                : isSystem
                    ? 'amelia-bubble amelia-bubble-system'
                    : 'amelia-bubble amelia-bubble-assistant',
            x_expand: !isSystem,
        });

        const label = isUser ? 'You' : isSystem ? 'System' : 'Amelia';
        const heading = new St.Label({
            text: label,
            style_class: 'amelia-bubble-heading',
        });
        bubble.add_child(heading);

        if (isPending) {
            const thinking = new St.Label({
                text: `Thinking${this._typingDots()}`,
                style_class: 'amelia-bubble-body amelia-thinking',
            });
            bubble.add_child(thinking);
        } else {
            const body = new St.Label({
                text: message.text,
                style_class: 'amelia-bubble-body',
            });
            body.clutter_text.line_wrap = true;
            body.clutter_text.line_wrap_mode = 0;
            bubble.add_child(body);
        }

        row.add_child(bubble);

        if (isUser || isSystem)
            row.add_child(new St.Widget({ x_expand: true }));

        return row;
    }

    _onSend() {
        const text = this._compose.trim();
        if (!text || this._busy || !this._canChat())
            return;

        this._busy = true;
        this._hasUserChatted = true;
        this._canResume = false;
        this._lastQuery = text;
        this._streamingReply = '';
        this._pendingId = `${Date.now()}`;
        this._compose = '';
        this._entry.set_text('');
        this._addMessage('user', text, false);
        this._addMessage('assistant', '', true);
        this._renderMessages();
        this._updateActions();
        this._updateStatusLabel();

        if (this._wsConnected && this._ws) {
            wsSend(this._ws, { type: 'chat', id: this._pendingId, message: text });
            return;
        }

        postChat(text, this._pendingId, (err, response) => {
            if (this._pendingId === '') return;
            this._busy = false;
            if (err) {
                this._canResume = this._lastQuery.length > 0;
                this._maybeNotifyReply(err.message);
                this._finalizePendingAssistant(err.message);
            } else if (response?.cancelled) {
                this._onQueryCancelled(response.reply || '');
            } else {
                this._canResume = false;
                const reply = response?.reply || '(empty reply)';
                this._maybeNotifyReply(reply);
                this._finalizePendingAssistant(reply);
            }
            this._pendingId = '';
            this._streamingReply = '';
            this._updateActions();
            this._updateStatusLabel();
        });
    }

    _onCancel() {
        if (!this._busy || !this._pendingId)
            return;
        const id = this._pendingId;
        if (this._wsConnected && this._ws) {
            wsSend(this._ws, { type: 'cancel', id });
            return;
        }
        postCancel(id, () => {});
    }

    _onResume() {
        if (this._busy || !this._canResume || !this._lastQuery)
            return;
        this._compose = this._lastQuery;
        this._entry.set_text(this._lastQuery);
        this._onSend();
    }

    destroy() {
        if (this._healthTimer) {
            GLib.source_remove(this._healthTimer);
            this._healthTimer = 0;
        }
        if (this._typingTimer) {
            GLib.source_remove(this._typingTimer);
            this._typingTimer = 0;
        }
        if (this._ws) {
            try {
                this._ws.close(1000, null);
            } catch (_e) {
                // ignore
            }
            this._ws = null;
        }
        super.destroy();
    }
});
