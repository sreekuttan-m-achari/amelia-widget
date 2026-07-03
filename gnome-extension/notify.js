import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export function truncateBody(text, maxChars = 240) {
    const flat = (text || '').replace(/\s+/g, ' ').trim();
    if (flat.length <= maxChars)
        return flat;
    return `${flat.slice(0, maxChars)}…`;
}

export function sendNotification(summary, body) {
    try {
        Gio.DBus.session.call(
            'org.freedesktop.Notifications',
            '/org/freedesktop/Notifications',
            'org.freedesktop.Notifications',
            'Notify',
            GLib.Variant.new('(susssasa{sv}i)', [
                'Amelia',
                0,
                'user-available-symbolic',
                summary,
                body,
                [],
                {},
                8000,
            ]),
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
        );
    } catch (err) {
        logError(err, 'Amelia notification failed');
    }
}

export function notifyReply(body) {
    sendNotification('Amelia', truncateBody(body));
}

export function notifyStatus(summary, body) {
    sendNotification(summary, body);
}
