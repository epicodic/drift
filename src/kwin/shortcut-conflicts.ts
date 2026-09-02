// Detects two kinds of KWin shortcut cleanup Drift can offer, and if either applies,
// tells the user to run the shipped setup-shortcuts.sh script (contents/bin/) to
// free the affected KWin actions:
//  1. Drift's own Meta+Tab / Meta+Shift+Tab (focus), Meta+Left/Right (align-cycle),
//     and Meta+Page_Up / Meta+Page_Down (row navigation) shortcuts couldn't be granted
//     (claimed by KWin's built-in window-walking, Quick Tile, and Maximize/Minimize
//     actions respectively).
//  2. Meta+Shift+Left/Right are still claimed by KWin's built-in Move Window to
//     Screen actions — checked unconditionally, independent of Drift's own bindings
//     (Drift itself now uses Meta+Tab / Meta+Shift+Tab for focus), purely so the user can
//     free those keys for their own use.
// No persisted "already asked" flag is kept — the check re-derives its answer from
// kglobalaccel every start, the same "derive state, don't store it" approach
// `align-cycle.ts` uses for its own phase. Freeing a KWin core action's shortcut here
// only clears the *declared* assignment; the live grab is only released after a
// logout/login (confirmed empirically — see repo notes).
//
// Why a shell script instead of releasing directly via DBus from here: KWin's QML
// `DBusCall` element can only send a generic `QVariantList` argument — a nested JS
// array of strings always marshals as DBus type "av" (array-of-variant), never "as"
// (array-of-string), so `org.kde.KGlobalAccel.setShortcut`'s required `QStringList`
// argument can't be built this way (confirmed empirically against a live KWin — see
// repo notes). `busctl`'s explicit type signature sidesteps that entirely, which is
// why setup-shortcuts.sh (using busctl) works where an in-script DBusCall wouldn't.

import { debug } from '../debug';

interface ReleaseTarget {
    kwinActionName: string;
    kwinActionText: string;
}

interface KnownConflict extends ReleaseTarget {
    driftActionName: string;
    driftActionText: string;
}

// KWin core actions whose defaults collide with Drift's own shortcut defaults (see
// settings.ts). Hardcoded rather than discovered dynamically — these are stable,
// well-known KWin action identifiers, confirmed against a live session
// (kglobalshortcutsrc). Exception: the DriftRowUp/DriftRowDown entries (Window
// Maximize/Minimize) are the standard KWin action identifiers by convention but have
// not yet been confirmed against a live session — verify against kglobalshortcutsrc
// before relying on them.
const KNOWN_CONFLICTS: KnownConflict[] = [
    {
        driftActionName: 'DriftFocusLeft',
        driftActionText: 'Drift: Focus Column Left',
        kwinActionName: 'Walk Through Windows (Reverse)',
        kwinActionText: 'Walk Through Windows (Reverse)',
    },
    {
        driftActionName: 'DriftFocusRight',
        driftActionText: 'Drift: Focus Column Right',
        kwinActionName: 'Walk Through Windows',
        kwinActionText: 'Walk Through Windows',
    },
    {
        driftActionName: 'DriftCycleAlignLeft',
        driftActionText: 'Drift: Cycle Column Align Left',
        kwinActionName: 'Window Quick Tile Left',
        kwinActionText: 'Quick Tile Window to the Left',
    },
    {
        driftActionName: 'DriftCycleAlignRight',
        driftActionText: 'Drift: Cycle Column Align Right',
        kwinActionName: 'Window Quick Tile Right',
        kwinActionText: 'Quick Tile Window to the Right',
    },
    {
        driftActionName: 'DriftRowUp',
        driftActionText: 'Drift: Page Row Up',
        kwinActionName: 'Window Maximize',
        kwinActionText: 'Maximize Window',
    },
    {
        driftActionName: 'DriftRowDown',
        driftActionText: 'Drift: Page Row Down',
        kwinActionName: 'Window Minimize',
        kwinActionText: 'Minimize Window',
    },
];

// Not tied to any Drift shortcut — offered purely so the user can free Meta+Shift+Left/
// Right for their own use, regardless of what Drift itself binds.
const STANDALONE_RELEASE_CANDIDATES: ReleaseTarget[] = [
    { kwinActionName: 'Window to Previous Screen', kwinActionText: 'Move Window to Previous Screen' },
    { kwinActionName: 'Window to Next Screen', kwinActionText: 'Move Window to Next Screen' },
];

const KGLOBALACCEL_SERVICE = 'org.kde.kglobalaccel';
const KGLOBALACCEL_COMPONENT_PATH = '/component/kwin';
const KGLOBALACCEL_COMPONENT_INTERFACE = 'org.kde.kglobalaccel.Component';

const RELEASE_SCRIPT_RELATIVE_PATH = '../bin/setup-shortcuts.sh';

/** A row of `allShortcutInfos()`'s `a(ssssssaiai)` reply, positionally destructured. Only
 * the two fields this module needs are named; the DBus signature is otherwise opaque
 * to us. Field 6 is `activeKeys`, field 7 is `defaultKeys` — confirmed by observing a
 * live cleared shortcut (active=[], default=[<code>]) after running
 * release-shortcuts.sh; an earlier guess had these swapped since both fields are
 * identical before anything is ever cleared. */
interface ShortcutInfoRow {
    actionUnique: string;
    activeKeys: unknown;
}

function parseShortcutInfoRows(returnValue: unknown[]): ShortcutInfoRow[] {
    const rows = returnValue[0];
    if (!Array.isArray(rows)) {
        return [];
    }
    return rows
        .filter((row): row is unknown[] => Array.isArray(row) && row.length >= 8)
        .map((row) => ({ actionUnique: String(row[0]), activeKeys: row[6] }));
}

function hasActiveGrant(row: ShortcutInfoRow | undefined): boolean {
    return row !== undefined && Array.isArray(row.activeKeys) && row.activeKeys.length > 0;
}

/** Resolves the on-disk path to setup-shortcuts.sh from `ui/main.qml`'s own resolved
 * directory URL, so the message is correct regardless of install location (user vs.
 * global kpackagetool6 install). */
function resolveReleaseScriptPath(scriptUiDirUrl: string): string {
    const dir = scriptUiDirUrl.replace(/^file:\/\//, '').replace(/\/$/, '');
    return `${dir}/${RELEASE_SCRIPT_RELATIVE_PATH}`;
}

function callAllShortcutInfos(parent: QmlObject, onFinished: (returnValue: unknown[]) => void): void {
    const qml = `import org.kde.kwin 3.0
DBusCall {
    service: ${JSON.stringify(KGLOBALACCEL_SERVICE)}
    path: ${JSON.stringify(KGLOBALACCEL_COMPONENT_PATH)}
    dbusInterface: ${JSON.stringify(KGLOBALACCEL_COMPONENT_INTERFACE)}
    method: "allShortcutInfos"
}`;
    const call = Qt.createQmlObject(qml, parent) as QmlDBusCall;
    call.finished.connect((returnValue) => {
        onFinished(returnValue);
        call.destroy();
    });
    call.failed.connect(() => {
        debug('shortcut-conflicts: DBus call allShortcutInfos failed');
        call.destroy();
    });
    call.call();
}

function announceConflicts(parent: QmlObject, toRelease: ReleaseTarget[], scriptUiDirUrl: string): void {
    const claimedBy = toRelease.map((t) => t.kwinActionText).join(', ');
    const scriptPath = resolveReleaseScriptPath(scriptUiDirUrl);
    const message =
        `Drift: these shortcuts are claimed by KWin (${claimedBy}) and could not be bound.\n` +
        `Run ${scriptPath}, then log out and back in for Drift to claim them.`;
    debug(message);
    createConflictNotice(parent, message);
}

/** Checks both kinds of shortcut cleanup described in the file header — Drift's own
 * unmet grants, and the standalone Meta+Shift+Left/Right release — and announces
 * whatever needs releasing in a single combined notice. Runs every start rather than
 * once, so it stays correct if the user (or KDE) changes the binding later. */
export function checkForShortcutConflicts(parent: QmlObject, scriptUiDirUrl: string): void {
    callAllShortcutInfos(parent, (returnValue) => {
        const rows = parseShortcutInfoRows(returnValue);
        const byActionName = new Map(rows.map((row) => [row.actionUnique, row]));
        const toRelease: ReleaseTarget[] = [];

        for (const conflict of KNOWN_CONFLICTS) {
            if (!hasActiveGrant(byActionName.get(conflict.driftActionName))) {
                toRelease.push(conflict);
            }
        }
        for (const candidate of STANDALONE_RELEASE_CANDIDATES) {
            if (hasActiveGrant(byActionName.get(candidate.kwinActionName))) {
                toRelease.push(candidate);
            }
        }

        if (toRelease.length > 0) {
            announceConflicts(parent, toRelease, scriptUiDirUrl);
        }
    });
}

interface ConflictNoticeOverlay extends QmlObject {
    message: string;
}

const NOTICE_QML = `import QtQuick 6.0
import org.kde.plasma.core as PlasmaCore
PlasmaCore.Dialog {
    id: dialog
    property string message: ""
    title: "Drift Shortcut Conflict"
    type: PlasmaCore.Dialog.OnScreenDisplay
    backgroundHints: PlasmaCore.Types.NoBackground
    flags: Qt.BypassWindowManagerHint | Qt.FramelessWindowHint | Qt.Popup
    outputOnly: true
    x: 20
    y: 20
    visible: true
    mainItem: Rectangle {
        radius: 5
        color: Qt.rgba(0, 0, 0, 0.85)
        implicitWidth: 700
        implicitHeight: 120
        Text {
            anchors.fill: parent
            anchors.margins: 15
            text: dialog.message
            color: "#ffffff"
            font.pixelSize: 14
            wrapMode: Text.Wrap
            verticalAlignment: Text.AlignTop
        }
    }
}`;

function createConflictNotice(parent: QmlObject, message: string): ConflictNoticeOverlay {
    const overlay = Qt.createQmlObject(NOTICE_QML, parent) as unknown as ConflictNoticeOverlay;
    overlay.message = message;
    return overlay;
}
