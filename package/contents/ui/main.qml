import QtQuick 2.15
import QtQuick.Layouts 1.15
import QtQuick.Controls 2.15 as QQC2
import QtWebSockets 1.1
import QtQuick.Window 2.15
import org.kde.kirigami 2.19 as Kirigami
import org.kde.plasma.core 2.0 as PlasmaCore
import org.kde.plasma.plasmoid 2.0
import org.kde.plasma.components 3.0 as PlasmaComponents

Item {
    id: root

    // Orb mode keeps a tiny desktop footprint; pinned mode uses the old size.
    implicitWidth: plasmoid.configuration.popOutMode
        ? Kirigami.Units.gridUnit * 3.4
        : Kirigami.Units.gridUnit * 19
    implicitHeight: plasmoid.configuration.popOutMode
        ? Kirigami.Units.gridUnit * 3.9
        : Kirigami.Units.gridUnit * 15
    Layout.minimumWidth: plasmoid.configuration.popOutMode
        ? Kirigami.Units.gridUnit * 2.8
        : Kirigami.Units.gridUnit * 14
    Layout.minimumHeight: plasmoid.configuration.popOutMode
        ? Kirigami.Units.gridUnit * 3.2
        : Kirigami.Units.gridUnit * 10
    Layout.preferredWidth: implicitWidth
    Layout.preferredHeight: implicitHeight

    // Pop-out mode (default): show a small pulsating orb on the desktop and
    // open the chat in a popup on click. Turn it off in settings to keep the
    // full chat panel pinned to the desktop like before.
    Plasmoid.preferredRepresentation: plasmoid.configuration.popOutMode
        ? Plasmoid.compactRepresentation
        : Plasmoid.fullRepresentation
    Plasmoid.backgroundHints: PlasmaCore.Types.NoBackground
    Plasmoid.toolTipMainText: i18n("Amelia")
    Plasmoid.toolTipSubText: root.statusLabel

    AriaTokens { id: ariaTheme }

    readonly property color aiGlow: ariaTheme.aiGlow
    readonly property color aiGlowSoft: ariaTheme.aiGlowSoft
    readonly property color aiViolet: ariaTheme.aiViolet
    readonly property color aiGlass: ariaTheme.aiGlass
    readonly property color aiGlassHi: ariaTheme.aiGlassHi
    readonly property color aiBorder: ariaTheme.aiBorder
    readonly property color aiText: ariaTheme.aiText
    readonly property color aiMuted: ariaTheme.aiMuted
    readonly property color aiError: ariaTheme.aiError

    // Balanced density — slightly tighter than default, not cramped
    readonly property real uiBodyPt: Kirigami.Theme.defaultFont.pointSize - 0.5
    readonly property real uiSmallPt: Kirigami.Theme.smallFont.pointSize - 0.5
    readonly property real uiCaptionPt: Kirigami.Theme.smallFont.pointSize - 1
    readonly property real uiPad: Kirigami.Units.smallSpacing + 2
    readonly property real uiGap: Kirigami.Units.smallSpacing + 1
    readonly property real uiRadius: ariaTheme.radiusPanel

    readonly property color userAccent: ariaTheme.userAccent
    readonly property color agentAccent: ariaTheme.agentAccent

    readonly property string apiBase: {
        var url = plasmoid.configuration.apiUrl || "http://127.0.0.1:8787";
        if (url.endsWith("/")) {
            url = url.slice(0, -1);
        }
        return url;
    }
    readonly property string wsUrl: {
        if (apiBase.indexOf("https://") === 0) {
            return "wss://" + apiBase.slice(8);
        }
        if (apiBase.indexOf("http://") === 0) {
            return "ws://" + apiBase.slice(7);
        }
        return "ws://127.0.0.1:8787";
    }
    readonly property string healthUrl: apiBase + "/health"
    readonly property string chatUrl: apiBase + "/chat"
    readonly property string chatCancelUrl: apiBase + "/chat/cancel"

    property bool busy: false
    property bool serverReady: false
    property bool wsConnected: false
    property bool connecting: true
    property bool connectionFailed: false
    property bool selfCheckDone: false
    property bool agentWarm: false
    property bool hasUserChatted: false
    property string startupGreeting: ""
    property string serverVersion: ""
    property bool hasPersona: false
    property bool hasUserProfile: false
    property string pendingId: ""
    property string streamingReply: ""
    property string lastQueryText: ""
    property bool canResume: false
    property var activeHttpXhr: null
    property bool immersiveActive: false
    property string composeText: ""
    property var immersiveWindow: null
    property string lastStatusNotifyKey: ""
    // Set when a reply lands while the popup is collapsed — drives the orb badge.
    property bool unreadReply: false
    // The ChatWorkspace living in the full representation (null while collapsed).
    property Item liveWorkspace: null

    signal chatScrollRequested()

    PlasmaCore.DataSource {
        id: notificationSource
        engine: "notifications"
        connectedSources: "org.freedesktop.Notifications"
    }

    function truncateNotifyBody(text, maxChars) {
        var flat = String(text || "").replace(/\s+/g, " ").trim();
        if (flat.length <= maxChars) {
            return flat;
        }
        return flat.substring(0, maxChars) + "…";
    }

    function desktopNotify(summary, body) {
        var service = notificationSource.serviceForSource("notification");
        if (!service) {
            return;
        }
        var operation = service.operationDescription("createNotification");
        operation.appName = "Amelia";
        operation["appIcon"] = "user-available";
        operation.summary = summary;
        operation["body"] = truncateNotifyBody(body, 240);
        operation["timeout"] = 8000;
        service.startOperationCall(operation);
    }

    function statusNotifyKey() {
        if (connectionFailed || !serverReady) {
            return "offline";
        }
        if (!agentWarm) {
            return "warming";
        }
        return "online";
    }

    function shouldNotifyUser() {
        if (!Qt.application.active) {
            return true;
        }
        if (immersiveWindow && immersiveWindow.active && immersiveWindow.visible) {
            return false;
        }
        if (!Plasmoid.expanded) {
            return true;
        }
        if (liveWorkspace && liveWorkspace.visible && liveWorkspace.chatInputActive) {
            return false;
        }
        return true;
    }

    function maybeNotifyReply(text) {
        if (!shouldNotifyUser()) {
            return;
        }
        desktopNotify("Amelia", text);
    }

    function syncStatusNotifications() {
        if (connecting) {
            return;
        }
        var key = statusNotifyKey();
        var previous = lastStatusNotifyKey;
        lastStatusNotifyKey = key;
        if (previous === key) {
            return;
        }
        if (key === "offline" && previous !== "offline") {
            desktopNotify("Amelia offline", "Cannot reach the backend API.");
        } else if (key === "online" && (previous === "offline" || previous === "warming")) {
            desktopNotify("Amelia online", "Backend is ready.");
        }
    }

    function markReplyArrived() {
        if (!Plasmoid.expanded) {
            unreadReply = true;
        }
    }

    function completeAssistantReply(text) {
        finalizePendingAssistant(text);
        markReplyArrived();
        maybeNotifyReply(text);
    }

    readonly property string statusLabel: {
        if (connectionFailed) {
            return qsTr("offline");
        }
        if (!serverReady) {
            return qsTr("checking…");
        }
        if (!agentWarm) {
            return qsTr("warming…");
        }
        if (wsConnected) {
            return qsTr("online ●");
        }
        return qsTr("online");
    }

    readonly property color statusColor: {
        if (connectionFailed) {
            return aiError;
        }
        if (serverReady) {
            return aiGlow;
        }
        return aiMuted;
    }

    ListModel {
        id: chatMessageModel
    }

    property alias messageModel: chatMessageModel

    function clearMessages() {
        chatMessageModel.clear();
    }

    function addMessage(role, text, pending) {
        chatMessageModel.append({
            role: role,
            text: text,
            pending: pending === true
        });
        scrollChatToEnd();
    }

    function scrollChatToEnd() {
        chatScrollRequested();
    }

    function appendUserMessage(text) {
        addMessage("user", text, false);
    }

    function appendPendingAssistant() {
        addMessage("assistant", "…", true);
    }

    function updatePendingAssistant(text) {
        for (var i = chatMessageModel.count - 1; i >= 0; i--) {
            if (chatMessageModel.get(i).role === "assistant" && chatMessageModel.get(i).pending) {
                chatMessageModel.setProperty(i, "text", text);
                scrollChatToEnd();
                return;
            }
        }
        addMessage("assistant", text, true);
    }

    function finalizePendingAssistant(text) {
        for (var i = chatMessageModel.count - 1; i >= 0; i--) {
            if (chatMessageModel.get(i).role === "assistant" && chatMessageModel.get(i).pending) {
                chatMessageModel.setProperty(i, "text", text);
                chatMessageModel.setProperty(i, "pending", false);
                scrollChatToEnd();
                return;
            }
        }
        addMessage("assistant", text, false);
    }

    function replacePendingAmeliaLine(text) {
        updatePendingAssistant(text);
    }

    function setAssistantGreeting(text) {
        clearMessages();
        addMessage("assistant", text, false);
    }

    function setSystemMessage(text) {
        clearMessages();
        addMessage("system", text, false);
    }

    function applyGreeting(text) {
        if (!text || text.length === 0) {
            return;
        }
        agentWarm = true;
        startupGreeting = text;
        if (!hasUserChatted && !busy) {
            setAssistantGreeting(text);
        }
    }

    function applyHealth(health) {
        if (health.greeting) {
            applyGreeting(health.greeting);
        } else if (health.warm) {
            agentWarm = true;
        }
    }

    function appendReply(role, text) {
        if (role === "user") {
            appendUserMessage(text);
        } else {
            addMessage("assistant", text, false);
        }
    }

    function buildSelfCheckSuccess(health) {
        var lines = [
            qsTr("Self-check: backend is up."),
            "",
            "✓ " + qsTr("Reachable at %1").arg(apiBase)
        ];
        if (health.version) {
            lines.push("✓ " + qsTr("API version %1").arg(health.version));
        }
        if (health.persona) {
            lines.push("✓ " + qsTr("Persona loaded (SOUL.md)"));
        } else {
            lines.push("○ " + qsTr("No persona — add server/SOUL.md for a custom voice"));
        }
        if (health.userProfile) {
            lines.push("✓ " + qsTr("User profile loaded (USER.md)"));
        }
        if (wsConnected) {
            lines.push("✓ " + qsTr("WebSocket connected — streaming replies"));
        } else {
            lines.push("○ " + qsTr("WebSocket not connected yet — using HTTP"));
        }
        lines.push("");
        lines.push(qsTr("You can chat now. Press Enter to send."));
        return lines.join("\n");
    }

    function buildSelfCheckFailure() {
        return [
            qsTr("Self-check: backend is down."),
            "",
            "✗ " + qsTr("No response from %1").arg(healthUrl),
            "",
            qsTr("Start the service:"),
            "  systemctl --user start amelia-widget",
            "",
            qsTr("Check logs:"),
            "  journalctl --user -u amelia-widget -f",
            "",
            qsTr("Tap Retry when the service is running.")
        ].join("\n");
    }

    function refreshSelfCheckMessage() {
        if (!selfCheckDone || !serverReady || busy || agentWarm) {
            return;
        }
        setSystemMessage(buildSelfCheckSuccess({
            version: serverVersion,
            persona: hasPersona,
            userProfile: hasUserProfile
        }));
    }

    function onBackendConnected(health) {
        connectionFailed = false;
        connectFailTimer.stop();
        serverReady = true;
        connecting = false;
        selfCheckDone = true;
        serverVersion = health.version || "";
        hasPersona = !!health.persona;
        hasUserProfile = !!health.userProfile;
        applyHealth(health);
        if (!agentWarm && !busy) {
            clearMessages();
        }
        socket.active = true;
        syncStatusNotifications();
    }

    function onBackendFailed() {
        connecting = false;
        connectionFailed = true;
        selfCheckDone = true;
        serverReady = false;
        setSystemMessage(buildSelfCheckFailure());
        syncStatusNotifications();
    }

    function checkHealth() {
        var xhr = new XMLHttpRequest();
        xhr.open("GET", healthUrl);
        xhr.onreadystatechange = function() {
            if (xhr.readyState !== XMLHttpRequest.DONE) {
                return;
            }
            if (xhr.status === 200) {
                try {
                    var body = JSON.parse(xhr.responseText);
                    if (body.ok) {
                        root.onBackendConnected(body);
                        return;
                    }
                } catch (e) {
                }
            }
        };
        xhr.send();
    }

    function retryConnection() {
        connecting = true;
        connectionFailed = false;
        serverReady = false;
        wsConnected = false;
        selfCheckDone = false;
        agentWarm = false;
        hasUserChatted = false;
        startupGreeting = "";
        clearMessages();
        connectFailTimer.restart();
        checkHealth();
        socket.active = false;
    }

    function formatCancelledReply(partial) {
        var stopped = qsTr("Stopped.");
        if (partial && partial.length > 0) {
            return partial + "\n\n— " + stopped;
        }
        return stopped;
    }

    function onQueryCancelled(partial) {
        busy = false;
        canResume = lastQueryText.length > 0;
        finalizePendingAssistant(formatCancelledReply(partial || streamingReply));
        streamingReply = "";
        pendingId = "";
        activeHttpXhr = null;
    }

    function cancelCurrentQuery() {
        if (!busy || pendingId.length === 0) {
            return;
        }
        var id = pendingId;
        if (socket.status === WebSocket.Open) {
            socket.sendTextMessage(JSON.stringify({ type: "cancel", id: id }));
            return;
        }
        var cxhr = new XMLHttpRequest();
        cxhr.open("POST", chatCancelUrl);
        cxhr.setRequestHeader("Content-Type", "application/json");
        cxhr.send(JSON.stringify({ id: id }));
    }

    function resumeCurrentQuery() {
        if (busy || !canResume || lastQueryText.length === 0) {
            return;
        }
        canResume = false;
        busy = true;
        streamingReply = "";
        pendingId = String(Date.now());
        appendPendingAssistant();

        if (socket.status === WebSocket.Open) {
            socket.sendTextMessage(JSON.stringify({
                type: "chat",
                id: pendingId,
                message: lastQueryText
            }));
            return;
        }

        sendViaHttp(lastQueryText);
    }

    function sendViaHttp(text) {
        if (activeHttpXhr) {
            activeHttpXhr.abort();
            activeHttpXhr = null;
        }
        var xhr = new XMLHttpRequest();
        activeHttpXhr = xhr;
        xhr.open("POST", chatUrl);
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.onreadystatechange = function() {
            if (xhr.readyState !== XMLHttpRequest.DONE) {
                return;
            }
            activeHttpXhr = null;
            if (xhr.status === 0) {
                return;
            }
            busy = false;
            if (xhr.status === 200) {
                try {
                    var body = JSON.parse(xhr.responseText);
                    if (body.cancelled) {
                        onQueryCancelled(body.reply || "");
                        return;
                    }
                    completeAssistantReply(body.reply || qsTr("(empty reply)"));
                    pendingId = "";
                    streamingReply = "";
                    return;
                } catch (e) {
                }
            }
            var err = qsTr("Request failed (HTTP %1)").arg(xhr.status);
            completeAssistantReply(err);
            pendingId = "";
            streamingReply = "";
        };
        xhr.send(JSON.stringify({ message: text, id: pendingId }));
    }

    function sendMessage(text) {
        var msg = text !== undefined ? String(text).trim() : "";
        if (msg.length === 0 || busy || !serverReady || !agentWarm) {
            return;
        }

        busy = true;
        hasUserChatted = true;
        canResume = false;
        lastQueryText = msg;
        streamingReply = "";
        pendingId = String(Date.now());
        appendUserMessage(msg);
        appendPendingAssistant();

        if (socket.status === WebSocket.Open) {
            socket.sendTextMessage(JSON.stringify({
                type: "chat",
                id: pendingId,
                message: msg
            }));
            return;
        }

        sendViaHttp(msg);
    }

    function immersiveScreenRect() {
        var g = plasmoid.screenGeometry;
        if (g.width > 0 && g.height > 0) {
            return Qt.rect(g.x, g.y, g.width, g.height);
        }
        return Qt.rect(Screen.virtualX, Screen.virtualY, Screen.width, Screen.height);
    }

    function ensureImmersiveWindow() {
        if (!immersiveWindow) {
            immersiveWindow = immersiveComponent.createObject(null, { widget: root });
        }
        return immersiveWindow;
    }

    function openImmersive() {
        if (!serverReady || !agentWarm) {
            return;
        }
        var win = ensureImmersiveWindow();
        win.screenRect = immersiveScreenRect();
        immersiveActive = true;
        win.active = true;
        Qt.callLater(syncImmersivePresentation);
    }

    function closeImmersive() {
        immersiveActive = false;
        if (immersiveWindow) {
            immersiveWindow.active = false;
        }
        Qt.callLater(function() {
            scrollChatToEnd();
            if (liveWorkspace) {
                liveWorkspace.focusInput();
            }
        });
    }

    function syncImmersivePresentation() {
        scrollChatToEnd();
        if (immersiveWindow) {
            immersiveWindow.screenRect = immersiveScreenRect();
            immersiveWindow.syncPresentation();
        }
    }

    function toggleImmersive() {
        if (immersiveActive) {
            closeImmersive();
        } else {
            openImmersive();
        }
    }

    function handleWsMessage(message) {
        var body;
        try {
            body = JSON.parse(message);
        } catch (e) {
            return;
        }

        if (body.type === "ready") {
            wsConnected = true;
            if (body.greeting) {
                applyGreeting(body.greeting);
            } else if (body.warm) {
                agentWarm = true;
            }
            return;
        }

        if (body.type === "greeting") {
            applyGreeting(body.text || "");
            return;
        }

        if (body.type === "chunk" && String(body.id) === pendingId) {
            streamingReply += body.text || "";
            replacePendingAmeliaLine(streamingReply);
            return;
        }

        if (body.type === "done" && String(body.id) === pendingId) {
            busy = false;
            canResume = false;
            var finalReply = body.reply || streamingReply || qsTr("(empty reply)");
            completeAssistantReply(finalReply);
            streamingReply = "";
            pendingId = "";
            return;
        }

        if (body.type === "cancelled" && String(body.id) === pendingId) {
            onQueryCancelled(body.reply || streamingReply);
            return;
        }

        if (body.type === "error" && (!body.id || String(body.id) === pendingId)) {
            busy = false;
            canResume = lastQueryText.length > 0;
            finalizePendingAssistant(body.error || qsTr("Unknown error"));
            markReplyArrived();
            maybeNotifyReply(body.error || qsTr("Unknown error"));
            streamingReply = "";
            pendingId = "";
        }
    }

    Timer {
        id: connectFailTimer
        interval: 12000
        repeat: false
        onTriggered: {
            if (!root.serverReady) {
                root.onBackendFailed();
            }
        }
    }

    Timer {
        id: healthPoll
        interval: 3000
        running: root.connecting && !root.connectionFailed
        repeat: true
        onTriggered: root.checkHealth()
    }

    Timer {
        id: warmupPoll
        interval: 1500
        running: root.serverReady && !root.agentWarm && !root.connectionFailed
        repeat: true
        onTriggered: root.checkHealth()
    }

    WebSocket {
        id: socket
        url: root.wsUrl
        active: false

        onTextMessageReceived: root.handleWsMessage(message)

        onStatusChanged: {
            if (status === WebSocket.Open) {
                root.wsConnected = true;
                root.refreshSelfCheckMessage();
            } else if (status === WebSocket.Closed || status === WebSocket.Error) {
                root.wsConnected = false;
                if (root.serverReady && !root.busy) {
                    root.refreshSelfCheckMessage();
                }
            }
        }
    }

    Component.onCompleted: {
        connectFailTimer.start();
        checkHealth();
    }

    // Collapse back to the orb / clean up unread state when the popup toggles.
    Connections {
        target: plasmoid
        function onExpandedChanged() {
            if (plasmoid.expanded) {
                root.unreadReply = false;
                root.scrollChatToEnd();
                if (root.liveWorkspace) {
                    root.liveWorkspace.focusInput();
                }
            }
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Collapsed state: a small pulsating orb that lives on the desktop.
    // Click it to pop the chat out; it reflects live status via colour.
    // ─────────────────────────────────────────────────────────────
    Plasmoid.compactRepresentation: MouseArea {
        id: orb

        Layout.minimumWidth: Kirigami.Units.gridUnit * 2.8
        Layout.minimumHeight: Kirigami.Units.gridUnit * 3.2
        Layout.preferredWidth: Kirigami.Units.gridUnit * 3.4
        Layout.preferredHeight: Kirigami.Units.gridUnit * 3.9

        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        acceptedButtons: Qt.LeftButton
        onClicked: plasmoid.expanded = !plasmoid.expanded

        readonly property bool thinking: root.busy
        readonly property bool degraded: root.connectionFailed
        readonly property bool waking: !root.connectionFailed && (!root.serverReady || !root.agentWarm)
        readonly property bool attention: root.unreadReply && !thinking
        readonly property color coreColor: {
            if (degraded) {
                return root.aiError;
            }
            if (waking) {
                return ariaTheme.statusWarming;
            }
            if (thinking) {
                return ariaTheme.statusThinking;
            }
            if (attention) {
                return ariaTheme.statusOnline;
            }
            return root.aiGlow;
        }
        // Idle breathes slowly; activity / attention pulses faster.
        readonly property int pulseMs: thinking ? 640 : (waking ? 900 : (attention ? 760 : 2400))

        ColumnLayout {
            anchors.fill: parent
            anchors.topMargin: 2
            spacing: Kirigami.Units.smallSpacing

            Item {
                id: orbVisual
                Layout.fillWidth: true
                Layout.fillHeight: true

                // Cap the orb so it stays small even if the widget is stretched.
                readonly property real d: Math.min(width, height, Kirigami.Units.gridUnit * 2.7)

                // Expanding ripple ring — the outward "pulse".
                Rectangle {
                    id: ripple
                    anchors.centerIn: parent
                    width: orbVisual.d * 0.62
                    height: width
                    radius: width / 2
                    color: "transparent"
                    border.width: 2
                    border.color: orb.coreColor
                    opacity: 0

                    SequentialAnimation {
                        running: true
                        loops: Animation.Infinite

                        ParallelAnimation {
                            NumberAnimation {
                                target: ripple
                                property: "scale"
                                from: 0.7
                                to: 1.55
                                duration: orb.pulseMs
                                easing.type: Easing.OutCubic
                            }
                            SequentialAnimation {
                                NumberAnimation {
                                    target: ripple
                                    property: "opacity"
                                    from: 0.0
                                    to: 0.5
                                    duration: orb.pulseMs * 0.35
                                    easing.type: Easing.OutCubic
                                }
                                NumberAnimation {
                                    target: ripple
                                    property: "opacity"
                                    to: 0.0
                                    duration: orb.pulseMs * 0.65
                                    easing.type: Easing.InCubic
                                }
                            }
                        }
                    }
                }

                // Soft halo that gently breathes.
                Rectangle {
                    anchors.centerIn: parent
                    width: orbVisual.d * 0.82
                    height: width
                    radius: width / 2
                    color: Qt.rgba(orb.coreColor.r, orb.coreColor.g, orb.coreColor.b, 0.16)
                    border.width: 1
                    border.color: Qt.rgba(orb.coreColor.r, orb.coreColor.g, orb.coreColor.b, 0.28)

                    SequentialAnimation on scale {
                        running: true
                        loops: Animation.Infinite
                        NumberAnimation { to: 1.08; duration: orb.pulseMs; easing.type: Easing.InOutSine }
                        NumberAnimation { to: 1.0; duration: orb.pulseMs; easing.type: Easing.InOutSine }
                    }
                }

                // Core orb with the Amelia monogram.
                Rectangle {
                    id: orbCore
                    anchors.centerIn: parent
                    width: orbVisual.d * 0.58
                    height: width
                    radius: width / 2
                    scale: orb.pressed ? 0.9 : (orb.containsMouse ? 1.07 : 1.0)
                    border.width: 1
                    border.color: Qt.rgba(1, 1, 1, 0.35)

                    gradient: Gradient {
                        GradientStop { position: 0.0; color: Qt.lighter(orb.coreColor, 1.4) }
                        GradientStop { position: 1.0; color: Qt.darker(orb.coreColor, 1.25) }
                    }

                    Behavior on scale { NumberAnimation { duration: 150; easing.type: Easing.OutCubic } }

                    // Glass sheen.
                    Rectangle {
                        anchors.horizontalCenter: parent.horizontalCenter
                        y: parent.height * 0.14
                        width: parent.width * 0.5
                        height: parent.height * 0.3
                        radius: height / 2
                        opacity: 0.45
                        gradient: Gradient {
                            GradientStop { position: 0.0; color: Qt.rgba(1, 1, 1, 0.7) }
                            GradientStop { position: 1.0; color: "transparent" }
                        }
                    }

                    // "A" monogram.
                    Text {
                        anchors.centerIn: parent
                        text: "A"
                        color: Qt.rgba(0.02, 0.05, 0.1, 0.82)
                        font.pointSize: Math.max(7, orbCore.width * 0.4)
                        font.weight: Font.Bold
                        font.letterSpacing: 0.5
                    }
                }

                // Unread badge — a reply landed while collapsed.
                Rectangle {
                    id: unreadBadge
                    visible: root.unreadReply
                    width: Math.max(8, orbVisual.d * 0.2)
                    height: width
                    radius: width / 2
                    color: ariaTheme.agentCore
                    border.width: 1.5
                    border.color: Qt.rgba(1, 1, 1, 0.85)
                    anchors.right: orbCore.right
                    anchors.top: orbCore.top
                    anchors.rightMargin: -width * 0.1
                    anchors.topMargin: -height * 0.1

                    SequentialAnimation on scale {
                        running: root.unreadReply
                        loops: Animation.Infinite
                        NumberAnimation { to: 1.3; duration: 520; easing.type: Easing.OutCubic }
                        NumberAnimation { to: 1.0; duration: 520; easing.type: Easing.InCubic }
                    }
                }
            }

            // Wordmark under the orb.
            QQC2.Label {
                Layout.fillWidth: true
                Layout.alignment: Qt.AlignHCenter
                horizontalAlignment: Text.AlignHCenter
                text: i18n("AMELIA")
                elide: Text.ElideRight
                color: orb.containsMouse ? root.aiGlow : root.aiText
                opacity: orb.containsMouse ? 1.0 : 0.72
                font.pointSize: Math.max(6, root.uiCaptionPt - 1)
                font.capitalization: Font.AllUppercase
                font.letterSpacing: 1.2
                font.weight: Font.DemiBold

                Behavior on color { ColorAnimation { duration: 160 } }
                Behavior on opacity { NumberAnimation { duration: 160 } }
            }
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Expanded state: the full chat panel, shown in a pop-out dialog
    // (or pinned to the desktop when pop-out mode is off).
    // ─────────────────────────────────────────────────────────────
    Plasmoid.fullRepresentation: Item {
        id: fullRoot

        Layout.minimumWidth: Kirigami.Units.gridUnit * 17
        Layout.minimumHeight: Kirigami.Units.gridUnit * 13
        Layout.preferredWidth: Kirigami.Units.gridUnit * 23
        Layout.preferredHeight: Kirigami.Units.gridUnit * 18

        // Local aliases so the markup below can stay unqualified.
        readonly property real uiPad: root.uiPad
        readonly property real uiGap: root.uiGap
        readonly property real uiRadius: root.uiRadius
        readonly property real uiBodyPt: root.uiBodyPt
        readonly property real uiSmallPt: root.uiSmallPt
        readonly property real uiCaptionPt: root.uiCaptionPt
        readonly property string statusLabel: root.statusLabel
        readonly property color statusColor: root.statusColor

        // Grow-and-fade so opening the chat feels like it rises from the orb.
        transformOrigin: Item.Center
        opacity: 0
        scale: 0.95

        ParallelAnimation {
            id: entrance
            NumberAnimation {
                target: fullRoot
                property: "opacity"
                from: 0.0
                to: 1.0
                duration: 170
                easing.type: Easing.OutCubic
            }
            NumberAnimation {
                target: fullRoot
                property: "scale"
                from: 0.95
                to: 1.0
                duration: 230
                easing.type: Easing.OutBack
                easing.overshoot: 1.02
            }
        }

        Connections {
            target: plasmoid
            function onExpandedChanged() {
                if (plasmoid.expanded) {
                    entrance.restart();
                }
            }
        }

        Component.onCompleted: {
            root.liveWorkspace = compactWorkspace;
            entrance.restart();
            if (plasmoid.expanded) {
                root.unreadReply = false;
                root.scrollChatToEnd();
                compactWorkspace.focusInput();
            }
        }
        Component.onDestruction: {
            if (root.liveWorkspace === compactWorkspace) {
                root.liveWorkspace = null;
            }
        }

    // Outer glass shell
    GlassPanel {
        anchors.fill: parent
        fillOpacity: 0.52
        glow: root.aiGlow
    }

    // Soft violet corner accent
    Rectangle {
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        anchors.margins: Kirigami.Units.smallSpacing
        width: parent.width * 0.45
        height: parent.height * 0.35
        radius: 16
        opacity: 0.55
        gradient: Gradient {
            orientation: Gradient.Horizontal
            GradientStop { position: 0; color: "transparent" }
            GradientStop { position: 1; color: root.aiViolet }
        }
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: uiPad
        anchors.bottomMargin: uiPad + 3
        spacing: uiGap

        RowLayout {
            Layout.fillWidth: true
            Layout.bottomMargin: Kirigami.Units.smallSpacing
            spacing: uiGap

            Kirigami.Heading {
                Layout.fillWidth: true
                level: 5
                text: i18n("Amelia")
                color: root.aiText
                font.pointSize: uiBodyPt + 0.5
                font.letterSpacing: 0.6
                font.weight: Font.DemiBold
            }

            Rectangle {
                visible: statusLabel.length > 0
                implicitHeight: statusLabelItem.implicitHeight + 8
                implicitWidth: statusLabelItem.implicitWidth + 14
                radius: implicitHeight / 2
                color: Qt.rgba(statusColor.r, statusColor.g, statusColor.b, 0.12)
                border.color: Qt.rgba(statusColor.r, statusColor.g, statusColor.b, 0.38)
                border.width: 1

                QQC2.Label {
                    id: statusLabelItem
                    anchors.centerIn: parent
                    text: statusLabel
                    color: statusColor
                    font.pointSize: uiCaptionPt
                    font.capitalization: Font.AllUppercase
                    font.letterSpacing: 0.4
                }
            }

            QQC2.Button {
                id: focusModeButton
                visible: root.serverReady && root.agentWarm
                text: root.immersiveActive ? i18n("Restore") : i18n("Focus")
                flat: true
                implicitHeight: Kirigami.Units.gridUnit * 1.85
                implicitWidth: Math.max(
                    Kirigami.Units.gridUnit * 3.6,
                    focusModeLabel.implicitWidth + uiPad
                )
                font.pointSize: uiCaptionPt
                onClicked: root.toggleImmersive()

                contentItem: Text {
                    id: focusModeLabel
                    text: focusModeButton.text
                    font: focusModeButton.font
                    color: root.aiGlow
                    horizontalAlignment: Text.AlignHCenter
                    verticalAlignment: Text.AlignVCenter
                }

                background: Rectangle {
                    radius: 6
                    color: focusModeButton.down
                        ? Qt.rgba(0.43, 0.78, 1.0, 0.22)
                        : (focusModeButton.hovered ? Qt.rgba(0.43, 0.78, 1.0, 0.14) : Qt.rgba(0.43, 0.78, 1.0, 0.08))
                    border.color: root.aiBorder
                    border.width: 1
                }
            }
        }

        Item {
            Layout.fillWidth: true
            Layout.fillHeight: true

            ColumnLayout {
                anchors.fill: parent
                spacing: uiGap
                visible: root.serverReady && root.agentWarm
                enabled: root.serverReady && root.agentWarm

                ChatWorkspace {
                    id: compactWorkspace
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    host: root
                    visible: !root.immersiveActive
                    enabled: visible
                }

                Item {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    visible: root.immersiveActive

                    Rectangle {
                        anchors.fill: parent
                        radius: uiRadius
                        color: root.aiGlassHi
                        border.color: root.aiBorder
                        border.width: 1
                    }

                    ColumnLayout {
                        anchors.centerIn: parent
                        spacing: uiGap

                        QQC2.Label {
                            Layout.alignment: Qt.AlignHCenter
                            text: qsTr("Focus mode")
                            color: root.aiText
                            font.pointSize: uiBodyPt
                        }

                        QQC2.Label {
                            Layout.alignment: Qt.AlignHCenter
                            text: qsTr("Same chat — press Exit or Esc in fullscreen to restore here")
                            color: root.aiMuted
                            font.pointSize: uiSmallPt
                            horizontalAlignment: Text.AlignHCenter
                            wrapMode: Text.WordWrap
                            width: parent.width * 0.85
                        }

                        QQC2.Button {
                            Layout.alignment: Qt.AlignHCenter
                            text: i18n("Open focus mode")
                            flat: true
                            onClicked: root.openImmersive()

                            background: Rectangle {
                                radius: uiRadius - 2
                                color: Qt.rgba(0.43, 0.78, 1.0, 0.1)
                                border.color: root.aiBorder
                                border.width: 1
                            }
                        }
                    }
                }
            }

            Item {
                anchors.fill: parent
                visible: !root.serverReady || !root.agentWarm

                GlassPanel {
                    anchors.fill: parent
                    fillOpacity: 0.48
                    glow: root.aiGlow
                    showShimmer: true
                }

                ColumnLayout {
                    anchors.centerIn: parent
                    spacing: Kirigami.Units.gridUnit

                    Loader {
                        id: selfCheckLoader
                        Layout.alignment: Qt.AlignHCenter
                        active: !root.serverReady || !root.agentWarm
                        source: "ModernLoader.qml"
                        onLoaded: {
                            item.variant = "ring";
                            item.accentColor = root.aiGlow;
                        }
                    }

                    Binding {
                        target: selfCheckLoader.item
                        property: "running"
                        value: !root.serverReady || !root.agentWarm
                        when: selfCheckLoader.item !== null
                    }

                    QQC2.Label {
                        Layout.alignment: Qt.AlignHCenter
                        text: root.serverReady
                            ? qsTr("Waking Amelia…")
                            : qsTr("Connecting to backend…")
                        color: root.aiText
                        font.pointSize: Kirigami.Theme.defaultFont.pointSize
                        font.letterSpacing: 0.4
                    }

                    QQC2.Label {
                        Layout.alignment: Qt.AlignHCenter
                        visible: !root.serverReady
                        text: qsTr("GET %1").arg(root.healthUrl)
                        color: root.aiMuted
                        font.pointSize: Kirigami.Theme.smallFont.pointSize
                        font.family: "monospace"
                    }

                    QQC2.Label {
                        Layout.alignment: Qt.AlignHCenter
                        visible: root.serverReady && !root.agentWarm
                        text: qsTr("Pre-warming agent session")
                        color: root.aiMuted
                        font.pointSize: Kirigami.Theme.smallFont.pointSize
                    }
                }
            }

            Item {
                anchors.fill: parent
                visible: root.connectionFailed

                GlassPanel {
                    anchors.fill: parent
                    fillOpacity: 0.48
                    glow: root.aiError
                    showShimmer: false
                }

                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: Kirigami.Units.smallSpacing
                    spacing: Kirigami.Units.smallSpacing

                    QQC2.ScrollView {
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        clip: true

                        ChatBubble {
                            width: parent.width
                            role: "system"
                            text: root.buildSelfCheckFailure()
                        }
                    }

                    QQC2.Button {
                        Layout.alignment: Qt.AlignHCenter
                        text: i18n("Retry self-check")
                        flat: true
                        onClicked: root.retryConnection()

                        background: Rectangle {
                            radius: uiRadius - 2
                            color: Qt.rgba(1, 0.42, 0.47, 0.14)
                            border.color: Qt.rgba(1, 0.42, 0.47, 0.35)
                            border.width: 1
                        }
                    }
                }
            }
        }
    }

    } // end Plasmoid.fullRepresentation

    Component {
        id: immersiveComponent
        ImmersiveWindow {}
    }
}
