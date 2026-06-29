import QtQuick 2.15
import org.kde.kirigami 2.19 as Kirigami

Item {
    id: control

    property bool running: false
    property color accentColor: Kirigami.Theme.highlightColor
    property string variant: "dots"

    implicitWidth: variant === "ring" ? 40 : 48
    implicitHeight: variant === "ring" ? 40 : 24

    // Bouncing dots — chat / compact
    Row {
        id: dotsRow
        anchors.centerIn: parent
        spacing: 7
        visible: control.variant === "dots"
        height: 20

        Repeater {
            model: 3

            Rectangle {
                width: 8
                height: 8
                radius: 4
                color: control.accentColor
                opacity: 0.3
                y: dotsRow.height / 2 - height / 2

                SequentialAnimation on y {
                    running: control.running && control.variant === "dots"
                    loops: Animation.Infinite
                    PauseAnimation { duration: index * 130 }
                    NumberAnimation {
                        to: -9
                        duration: 300
                        easing.type: Easing.OutCubic
                    }
                    NumberAnimation {
                        to: dotsRow.height / 2 - height / 2
                        duration: 300
                        easing.type: Easing.InCubic
                    }
                    PauseAnimation { duration: 200 }
                }

                SequentialAnimation on opacity {
                    running: control.running && control.variant === "dots"
                    loops: Animation.Infinite
                    PauseAnimation { duration: index * 130 }
                    NumberAnimation { to: 1.0; duration: 300 }
                    NumberAnimation { to: 0.3; duration: 300 }
                    PauseAnimation { duration: 200 }
                }

                SequentialAnimation on scale {
                    running: control.running && control.variant === "dots"
                    loops: Animation.Infinite
                    PauseAnimation { duration: index * 130 }
                    NumberAnimation { to: 1.15; duration: 300 }
                    NumberAnimation { to: 1.0; duration: 300 }
                    PauseAnimation { duration: 200 }
                }
            }
        }
    }

    // Orbiting dot ring — self-check overlay
    Item {
        id: ringHost
        anchors.centerIn: parent
        width: 40
        height: 40
        visible: control.variant === "ring"

        Rectangle {
            anchors.centerIn: parent
            width: 34
            height: 34
            radius: 17
            color: "transparent"
            border.width: 2
            border.color: Qt.rgba(control.accentColor.r, control.accentColor.g, control.accentColor.b, 0.18)

            SequentialAnimation on border.width {
                running: control.running && control.variant === "ring"
                loops: Animation.Infinite
                NumberAnimation { to: 2.8; duration: 700; easing.type: Easing.InOutQuad }
                NumberAnimation { to: 2; duration: 700; easing.type: Easing.InOutQuad }
            }
        }

        Item {
            id: orbit
            anchors.centerIn: parent
            width: 34
            height: 34

            Rectangle {
                id: orb
                width: 9
                height: 9
                radius: 4.5
                color: control.accentColor
                anchors.horizontalCenter: parent.horizontalCenter
                y: 0

                SequentialAnimation on scale {
                    running: control.running && control.variant === "ring"
                    loops: Animation.Infinite
                    NumberAnimation { to: 1.2; duration: 500; easing.type: Easing.InOutQuad }
                    NumberAnimation { to: 0.85; duration: 500; easing.type: Easing.InOutQuad }
                }
            }

            RotationAnimation on rotation {
                running: control.running && control.variant === "ring"
                from: 0
                to: 360
                duration: 1100
                loops: Animation.Infinite
                easing.type: Easing.InOutCubic
            }
        }

        opacity: control.running ? 1 : 0.4
        Behavior on opacity { NumberAnimation { duration: 200 } }
    }
}
