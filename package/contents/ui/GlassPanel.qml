import QtQuick 2.15
import org.kde.kirigami 2.19 as Kirigami

Item {
    id: glass

    property alias radius: panel.radius
    property real fillOpacity: 0.58
    property color tint: "#161822"
    property color glow: "#9DD9F3"
    property bool showShimmer: true

    implicitWidth: panel.width
    implicitHeight: panel.height

    Rectangle {
        id: panel
        anchors.fill: parent
        radius: 14
        color: Qt.rgba(glass.tint.r, glass.tint.g, glass.tint.b, glass.fillOpacity)
        border.width: 1
        border.color: Qt.rgba(glass.glow.r, glass.glow.g, glass.glow.b, 0.22)

        Rectangle {
            anchors.fill: parent
            anchors.margins: 1
            radius: panel.radius - 1
            color: "transparent"
            border.width: 1
            border.color: Qt.rgba(1, 1, 1, 0.05)
        }

        Rectangle {
            anchors.top: parent.top
            anchors.left: parent.left
            anchors.right: parent.right
            height: parent.height * 0.42
            radius: panel.radius
            gradient: Gradient {
                GradientStop {
                    position: 0
                    color: Qt.rgba(glass.glow.r, glass.glow.g, glass.glow.b, 0.1)
                }
                GradientStop { position: 1; color: "transparent" }
            }
        }

        Rectangle {
            visible: glass.showShimmer
            anchors.top: parent.top
            anchors.topMargin: 0
            anchors.horizontalCenter: parent.horizontalCenter
            width: parent.width * 0.55
            height: 1
            opacity: 0.55
            gradient: Gradient {
                orientation: Gradient.Horizontal
                GradientStop { position: 0; color: "transparent" }
                GradientStop {
                    position: 0.5
                    color: Qt.rgba(glass.glow.r, glass.glow.g, glass.glow.b, 0.75)
                }
                GradientStop { position: 1; color: "transparent" }
            }
        }

        SequentialAnimation on opacity {
            running: glass.showShimmer
            loops: Animation.Infinite
            NumberAnimation { to: 0.92; duration: 2800; easing.type: Easing.InOutSine }
            NumberAnimation { to: 1.0; duration: 2800; easing.type: Easing.InOutSine }
        }
    }
}
