import QtQuick 2.15
import QtQuick.Controls 2.15 as QQC2
import QtQuick.Layouts 1.15
import org.kde.kirigami 2.19 as Kirigami

Kirigami.FormLayout {
    id: page

    property alias cfg_apiUrl: apiUrlField.text
    property alias cfg_popOutMode: popOutModeCheck.checked

    QQC2.CheckBox {
        id: popOutModeCheck
        Kirigami.FormData.label: i18n("Desktop mode:")
        text: i18n("Collapse to a pulsating orb when idle")
    }

    QQC2.Label {
        text: i18n("The chat pops out when you click the orb and tucks away when you click elsewhere. Turn this off to keep the full chat panel pinned to the desktop.")
        wrapMode: Text.WordWrap
        opacity: 0.7
        Layout.maximumWidth: Kirigami.Units.gridUnit * 18
    }

    Item {
        Kirigami.FormData.isSection: true
    }

    QQC2.TextField {
        id: apiUrlField
        Kirigami.FormData.label: i18n("Amelia API URL:")
        Layout.minimumWidth: Kirigami.Units.gridUnit * 16
        placeholderText: "http://127.0.0.1:8787"
    }
}
