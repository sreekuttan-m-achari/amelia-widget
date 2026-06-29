import QtQuick 2.15
import QtQuick.Layouts 1.15
import QtQuick.Controls 2.15 as QQC2
import org.kde.kirigami 2.19 as Kirigami

Item {
    id: workspace

    property var host
    property bool immersive: false

    readonly property real bodyPt: host ? (immersive ? host.uiBodyPt + 1.5 : host.uiBodyPt) : 10
    readonly property real smallPt: host ? (immersive ? host.uiSmallPt + 0.5 : host.uiSmallPt) : 9
    readonly property real pad: host ? (immersive ? host.uiPad + 4 : host.uiPad) : 8
    readonly property real gap: host ? (immersive ? host.uiGap + 2 : host.uiGap) : 6
    readonly property real radius: host ? (immersive ? host.uiRadius + 2 : host.uiRadius) : 12

    function scrollToEnd() {
        Qt.callLater(function() {
            var flick = chatScroll.contentItem;
            if (!flick) {
                return;
            }
            if (flick.contentHeight > flick.height) {
                flick.contentY = flick.contentHeight - flick.height;
            }
        });
    }

    function focusInput() {
        inputField.forceActiveFocus();
    }

    Connections {
        target: host
        enabled: host !== null
        function onChatScrollRequested() {
            workspace.scrollToEnd();
        }
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: gap
        enabled: host !== null

        Item {
            Layout.fillWidth: true
            Layout.fillHeight: true

            Rectangle {
                anchors.fill: parent
                radius: radius
                color: host.aiGlassHi
                border.color: host.aiBorder
                border.width: 1
            }

            QQC2.ScrollView {
                id: chatScroll
                anchors.fill: parent
                anchors.margins: pad
                clip: true

                Column {
                    id: messageColumn
                    width: Math.max(
                        chatScroll.availableWidth,
                        chatScroll.width - pad * 2
                    )
                    spacing: Kirigami.Units.gridUnit * (immersive ? 0.75 : 0.55)
                    topPadding: pad + 2
                    bottomPadding: pad + 2

                    Repeater {
                        model: host ? host.messageModel : null

                        ChatBubble {
                            width: messageColumn.width
                            role: model.role
                            text: model.text
                            pending: model.pending
                        }
                    }
                }
            }
        }

        RowLayout {
            Layout.fillWidth: true
            spacing: gap

            QQC2.TextField {
                id: inputField
                Layout.fillWidth: true
                Layout.preferredHeight: Kirigami.Units.gridUnit * (immersive ? 3.2 : 2.5)
                placeholderText: i18n("Message Amelia…")
                enabled: host && !host.busy
                text: host ? host.composeText : ""
                color: host ? host.aiText : "#eef6ff"
                placeholderTextColor: host ? host.aiMuted : "#8899aa"
                font.pointSize: bodyPt
                selectByMouse: true
                topPadding: immersive ? 10 : 6
                bottomPadding: immersive ? 10 : 6
                leftPadding: pad
                rightPadding: pad

                onTextChanged: {
                    if (host) {
                        host.composeText = text;
                    }
                }

                background: Rectangle {
                    radius: radius - 2
                    color: Qt.rgba(0, 0, 0, 0.18)
                    border.width: inputField.activeFocus ? 1.5 : 1
                    border.color: inputField.activeFocus ? host.aiGlowSoft : host.aiBorder

                    Behavior on border.color {
                        ColorAnimation { duration: 200; easing.type: Easing.OutCubic }
                    }
                }

                onAccepted: workspace.submitMessage()

                Keys.onReturnPressed: {
                    if (!(event.modifiers & Qt.ShiftModifier)) {
                        workspace.submitMessage();
                        event.accepted = true;
                    }
                }
            }

            QQC2.Button {
                id: cancelButton
                visible: host.busy
                text: i18n("Cancel")
                flat: true
                implicitHeight: Kirigami.Units.gridUnit * (immersive ? 3.2 : 2.5)
                implicitWidth: Kirigami.Units.gridUnit * 4.5
                font.pointSize: smallPt
                onClicked: host.cancelCurrentQuery()

                contentItem: Text {
                    text: cancelButton.text
                    font: cancelButton.font
                    color: host.aiError
                    horizontalAlignment: Text.AlignHCenter
                    verticalAlignment: Text.AlignVCenter
                }

                background: Rectangle {
                    radius: radius - 2
                    color: Qt.rgba(1, 0.42, 0.47, 0.12)
                    border.color: Qt.rgba(1, 0.42, 0.47, 0.35)
                    border.width: 1
                }
            }

            QQC2.Button {
                id: resumeButton
                visible: host.canResume && !host.busy
                text: i18n("Resume")
                flat: true
                implicitHeight: Kirigami.Units.gridUnit * (immersive ? 3.2 : 2.5)
                implicitWidth: Kirigami.Units.gridUnit * 4.5
                font.pointSize: smallPt
                onClicked: host.resumeCurrentQuery()

                contentItem: Text {
                    text: resumeButton.text
                    font: resumeButton.font
                    color: host.aiGlow
                    horizontalAlignment: Text.AlignHCenter
                    verticalAlignment: Text.AlignVCenter
                }

                background: Rectangle {
                    radius: radius - 2
                    color: Qt.rgba(0.43, 0.78, 1.0, 0.1)
                    border.color: host.aiBorder
                    border.width: 1
                }
            }

            QQC2.Button {
                id: sendButton
                text: i18n("Send")
                enabled: !host.busy && inputField.text.trim().length > 0
                flat: true
                implicitHeight: Kirigami.Units.gridUnit * (immersive ? 3.2 : 2.5)
                implicitWidth: Kirigami.Units.gridUnit * (immersive ? 5 : 4)
                font.pointSize: smallPt
                onClicked: workspace.submitMessage()

                contentItem: Text {
                    text: sendButton.text
                    font: sendButton.font
                    color: sendButton.enabled ? "#061018" : host.aiMuted
                    horizontalAlignment: Text.AlignHCenter
                    verticalAlignment: Text.AlignVCenter
                }

                background: Rectangle {
                    radius: radius - 2
                    opacity: sendButton.enabled ? 1 : 0.45
                    gradient: Gradient {
                        orientation: Gradient.Horizontal
                        GradientStop { position: 0; color: Qt.rgba(0.38, 0.72, 1.0, 0.85) }
                        GradientStop { position: 1; color: Qt.rgba(0.52, 0.62, 0.98, 0.8) }
                    }
                    border.color: Qt.rgba(1, 1, 1, 0.18)
                    border.width: 1
                }
            }
        }

        Loader {
            id: chatBusyLoader
            Layout.alignment: Qt.AlignHCenter
            active: host.busy
            visible: host.busy
            source: "ModernLoader.qml"
            onLoaded: {
                item.variant = "dots";
                item.accentColor = host.aiGlow;
            }
        }

        Binding {
            target: chatBusyLoader.item
            property: "running"
            value: host.busy
            when: chatBusyLoader.item !== null
        }
    }

    function submitMessage() {
        if (!host) {
            return;
        }
        var text = inputField.text.trim();
        if (text.length === 0) {
            return;
        }
        host.composeText = "";
        inputField.text = "";
        host.sendMessage(text);
    }
}
