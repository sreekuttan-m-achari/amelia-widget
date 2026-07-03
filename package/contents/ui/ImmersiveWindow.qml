import QtQuick 2.15
import QtQuick.Window 2.15
import QtQuick.Layouts 1.15
import QtQuick.Controls 2.15 as QQC2
import org.kde.kirigami 2.19 as Kirigami

Window {
    id: immersive

    property var widget
    property bool active: false
    property rect screenRect: Qt.rect(
        Screen.virtualX,
        Screen.virtualY,
        Screen.width,
        Screen.height
    )

    color: "#03060c"
    flags: Qt.Window | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint

    function applyScreenGeometry() {
        x = screenRect.x;
        y = screenRect.y;
        width = screenRect.width;
        height = screenRect.height;
    }

    onActiveChanged: {
        if (active) {
            applyScreenGeometry();
            show();
            requestActivate();
            raise();
            syncPresentation();
        } else {
            hide();
        }
    }

    onScreenRectChanged: {
        if (active) {
            applyScreenGeometry();
        }
    }

    function syncPresentation() {
        Qt.callLater(function() {
            if (chatWorkspace) {
                chatWorkspace.scrollToEnd();
                chatWorkspace.focusInput();
            }
        });
    }

    GlassPanel {
        anchors.fill: parent
        fillOpacity: 0.62
        glow: widget ? widget.aiGlow : "#9DD9F3"
        radius: 0
    }

    Rectangle {
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        anchors.margins: Kirigami.Units.gridUnit * 2
        width: parent.width * 0.38
        height: parent.height * 0.28
        radius: 24
        opacity: 0.45
        gradient: Gradient {
            orientation: Gradient.Horizontal
            GradientStop { position: 0; color: "transparent" }
            GradientStop {
                position: 1
                color: widget ? widget.aiViolet : Qt.rgba(0.62, 0.48, 0.98, 0.18)
            }
        }
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: Kirigami.Units.gridUnit * 2.5
        spacing: Kirigami.Units.gridUnit

        RowLayout {
            Layout.fillWidth: true
            spacing: Kirigami.Units.smallSpacing

            Kirigami.Heading {
                Layout.fillWidth: true
                level: 3
                text: i18n("Amelia")
                color: widget ? widget.aiText : "#eef6ff"
                font.letterSpacing: 0.8
                font.weight: Font.DemiBold
            }

            QQC2.Label {
                visible: widget && widget.statusLabel.length > 0
                text: widget ? widget.statusLabel : ""
                color: widget ? widget.statusColor : "#9DD9F3"
                font.pointSize: widget ? widget.uiCaptionPt : 10
                font.capitalization: Font.AllSmallCaps
                padding: 8
                background: Rectangle {
                    radius: height / 2
                    color: widget
                        ? Qt.rgba(widget.statusColor.r, widget.statusColor.g, widget.statusColor.b, 0.12)
                        : "transparent"
                    border.color: widget
                        ? Qt.rgba(widget.statusColor.r, widget.statusColor.g, widget.statusColor.b, 0.38)
                        : "transparent"
                    border.width: 1
                }
            }

            QQC2.Button {
                id: exitButton
                text: i18n("Exit")
                flat: true
                implicitHeight: Kirigami.Units.gridUnit * 1.9
                implicitWidth: Math.max(
                    Kirigami.Units.gridUnit * 3.8,
                    exitLabel.implicitWidth + Kirigami.Units.smallSpacing * 2
                )
                font.pointSize: widget ? widget.uiCaptionPt : 10
                onClicked: widget ? widget.closeImmersive() : (immersive.active = false)

                contentItem: Text {
                    id: exitLabel
                    text: exitButton.text
                    font: exitButton.font
                    color: widget ? widget.aiGlow : "#9DD9F3"
                    horizontalAlignment: Text.AlignHCenter
                    verticalAlignment: Text.AlignVCenter
                }

                background: Rectangle {
                    radius: 6
                    color: exitButton.down
                        ? Qt.rgba(0.43, 0.78, 1.0, 0.2)
                        : (exitButton.hovered
                            ? Qt.rgba(0.43, 0.78, 1.0, 0.14)
                            : Qt.rgba(0.43, 0.78, 1.0, 0.08))
                    border.color: widget ? widget.aiBorder : Qt.rgba(0.43, 0.78, 1.0, 0.35)
                    border.width: 1

                    Behavior on color {
                        ColorAnimation { duration: 150; easing.type: Easing.OutCubic }
                    }
                }
            }
        }

        QQC2.Label {
            Layout.fillWidth: true
            text: i18n("Focus mode — press Esc or Exit to return to the desktop widget")
            color: widget ? widget.aiMuted : "#8899aa"
            font.pointSize: widget ? widget.uiSmallPt : 10
            opacity: 0.85
        }

        ChatWorkspace {
            id: chatWorkspace
            Layout.fillWidth: true
            Layout.fillHeight: true
            host: widget
            immersive: true
            visible: widget && widget.serverReady && widget.agentWarm
            enabled: visible
        }
    }

    Shortcut {
        sequence: "Escape"
        onActivated: widget ? widget.closeImmersive() : (immersive.active = false)
    }
}
