import QtQuick 2.15
import org.kde.kirigami 2.19 as Kirigami

Item {
    id: bubbleRoot

    property string role: "assistant"
    property string text: ""
    property bool pending: false

    readonly property bool isUser: role === "user"
    readonly property bool isSystem: role === "system"
    readonly property string speakerLabel: {
        if (isUser) {
            return qsTr("You");
        }
        if (isSystem) {
            return "";
        }
        return qsTr("Amelia");
    }
    readonly property color labelAccent: {
        if (isUser) {
            return "#9DD9F3";
        }
        if (isSystem) {
            return "#ff8a96";
        }
        return "#C4B5FD";
    }
    readonly property color bubbleFill: {
        if (isUser) {
            return Qt.rgba(0.18, 0.55, 0.78, 0.28);
        }
        if (isSystem) {
            return Qt.rgba(0.55, 0.18, 0.22, 0.2);
        }
        return Qt.rgba(0.48, 0.4, 0.92, 0.2);
    }
    readonly property color bubbleBorder: {
        if (isUser) {
            return Qt.rgba(0.42, 0.78, 1.0, 0.38);
        }
        if (isSystem) {
            return Qt.rgba(1.0, 0.42, 0.5, 0.32);
        }
        return Qt.rgba(0.62, 0.55, 0.98, 0.34);
    }
    readonly property color bodyColor: Qt.rgba(0.93, 0.97, 1.0, 0.94)

    readonly property real bodyPt: Kirigami.Theme.defaultFont.pointSize - 0.5
    readonly property real labelPt: Kirigami.Theme.smallFont.pointSize - 1
    readonly property real hPad: Kirigami.Units.gridUnit * 0.65
    readonly property real vPad: Kirigami.Units.smallSpacing + 4
    readonly property real bubbleRadius: 14
    readonly property real laneWidth: Math.max(width, Kirigami.Units.gridUnit * 10)
    readonly property real minBubbleWidth: Kirigami.Units.gridUnit * 4.5
    readonly property real maxBubbleWidth: {
        if (isSystem) {
            return laneWidth * 0.92;
        }
        if (isUser) {
            return laneWidth * 0.76;
        }
        return laneWidth * 0.84;
    }
    readonly property real innerMaxWidth: Math.max(32, maxBubbleWidth - hPad * 2)
    readonly property real fittedBubbleWidth: Math.min(
        maxBubbleWidth,
        Math.max(
            minBubbleWidth,
            Math.max(measureText.contentWidth, speakerLabelText.visible ? speakerLabelText.contentWidth : 0) + hPad * 2
        )
    )
    readonly property real innerWidth: Math.max(24, fittedBubbleWidth - hPad * 2)
    readonly property real sideInset: Kirigami.Units.smallSpacing + 2

    width: parent ? parent.width : laneWidth
    implicitHeight: laneColumn.implicitHeight + Kirigami.Units.smallSpacing

    // Measure wrapped layout at max width, then shrink bubble to longest line.
    Text {
        id: measureText
        visible: false
        width: innerMaxWidth
        text: bubbleRoot.text
        font.pointSize: bodyPt
        font.family: Kirigami.Theme.defaultFont.family
        lineHeight: 1.35
        lineHeightMode: Text.ProportionalHeight
        wrapMode: Text.WordWrap
    }

    Column {
        id: laneColumn
        width: parent.width
        spacing: Kirigami.Units.smallSpacing * 0.6

        Item {
            width: parent.width
            height: speakerLabelText.visible ? speakerLabelText.implicitHeight : 0
            visible: speakerLabelText.visible

            Text {
                id: speakerLabelText
                visible: bubbleRoot.speakerLabel.length > 0
                anchors.right: isUser ? bubbleAnchor.right : undefined
                anchors.left: !isUser ? bubbleAnchor.left : undefined
                text: bubbleRoot.speakerLabel
                color: labelAccent
                font.pointSize: labelPt
                font.capitalization: Font.AllUppercase
                font.letterSpacing: 0.55
                font.weight: Font.DemiBold
            }

            Item {
                id: bubbleAnchor
                width: fittedBubbleWidth
                anchors.right: isUser ? parent.right : undefined
                anchors.rightMargin: isUser ? sideInset : 0
                anchors.left: !isUser ? parent.left : undefined
                anchors.leftMargin: !isUser ? sideInset : 0
                height: 0
            }
        }

        Row {
            width: parent.width
            layoutDirection: isUser ? Qt.RightToLeft : Qt.LeftToRight

            Item {
                width: sideInset
                height: 1
            }

            Rectangle {
                id: bubble
                width: fittedBubbleWidth
                height: messageText.implicitHeight + vPad * 2
                radius: bubbleRadius
                color: bubbleFill
                border.color: bubbleBorder
                border.width: 1
                clip: true

                Rectangle {
                    anchors.top: parent.top
                    anchors.left: parent.left
                    anchors.right: parent.right
                    height: parent.height * 0.38
                    radius: bubbleRadius
                    gradient: Gradient {
                        GradientStop {
                            position: 0
                            color: Qt.rgba(1, 1, 1, isUser ? 0.07 : 0.05)
                        }
                        GradientStop { position: 1; color: "transparent" }
                    }
                }

                Text {
                    id: messageText
                    anchors.top: parent.top
                    anchors.left: parent.left
                    anchors.topMargin: vPad
                    anchors.leftMargin: hPad
                    width: innerWidth
                    text: bubbleRoot.text
                    color: bodyColor
                    font.pointSize: bodyPt
                    font.family: Kirigami.Theme.defaultFont.family
                    lineHeight: 1.35
                    lineHeightMode: Text.ProportionalHeight
                    wrapMode: Text.WordWrap
                    horizontalAlignment: isUser ? Text.AlignRight : Text.AlignLeft
                    opacity: pending && text === "…" ? 0.55 : 1
                }
            }

            Item {
                width: isUser ? sideInset : parent.width * 0.06
                height: 1
            }
        }
    }
}
