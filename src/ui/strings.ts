/**
 * Centralized UI copy — GERMAN for V1 (JOBS.md J8), i18n-ready shape: one plain
 * nested object, keys are stable identifiers, values are the display strings.
 * A later i18n pass swaps this module for a locale lookup with the same shape.
 *
 * Tone (CLAUDE.md §7): honest and minimal. No gamified exaggeration; the app
 * says exactly what it measures.
 */

export const strings = {
  app: {
    name: 'Time Served',
  },

  tabs: {
    home: 'Home',
    history: 'Verlauf',
    boxes: 'Boxen',
    groups: 'Gruppen',
    settings: 'Einstellungen',
  },

  common: {
    cancel: 'Abbrechen',
    back: 'Zurück',
    next: 'Weiter',
    done: 'Fertig',
    save: 'Speichern',
    delete: 'Löschen',
    edit: 'Bearbeiten',
    yes: 'Ja',
    no: 'Nein',
    ok: 'OK',
    loading: 'Lädt…',
    today: 'Heute',
    yesterday: 'Gestern',
    day: 'Tag',
    night: 'Nacht',
    total: 'Gesamt',
    error: 'Fehler',
  },

  home: {
    idleTitle: 'Leg dein Handy in eine Box',
    idleHint: 'Entsperren → Kabel anschließen → in die Box legen.',
    armedTitle: 'Warte auf Ladekabel…',
    armedHint: 'Schließe jetzt das Ladekabel an, damit die Zeit zählt.',
    armedCountdownLabel: 'Verbleibende Zeit',
    activeTitle: 'Zeit läuft',
    activeSince: 'Seit',
    boxLabel: 'Box',
    todayHeading: 'Heute',
    noTimeToday: 'Heute noch keine Zeit abgesessen.',
  },

  dayNightBar: {
    dayLabel: 'Tag',
    nightLabel: 'Nacht',
    accessibility: 'Tag: {day}, Nacht: {night}',
    empty: 'Keine Zeit erfasst',
  },

  history: {
    title: 'Verlauf',
    empty: 'Noch keine abgeschlossenen Sitzungen.',
    sealedBadge: 'Versiegelt',
    sealedHint: 'Dieser Tag ist versiegelt und kann nicht mehr bearbeitet werden.',
    sessionsHeading: 'Sitzungen',
    noSessions: 'Keine Sitzungen an diesem Tag.',
    endReasonUnplug: 'abgesteckt',
    endReasonReconciled: 'nachträglich abgeschlossen',
    endReasonManual: 'manuell',
    editSession: 'Sitzung bearbeiten',
    startLabel: 'Start',
    endLabel: 'Ende',
    deleteSession: 'Sitzung löschen',
    deleteConfirm: 'Diese Sitzung wirklich löschen? Die Tageszeiten werden neu berechnet.',
    editInvalid: 'Start muss vor dem Ende liegen.',
  },

  boxes: {
    title: 'Boxen',
    empty: 'Noch keine Box registriert.',
    foreignBadge: 'von anderem Mitglied',
    registerNew: 'Neue Box registrieren',
    locationFallback: 'Kein Ort angegeben',
    deleteConfirm: 'Diese Box wirklich entfernen? Vorhandene Sitzungen bleiben erhalten.',
    editTitle: 'Box bearbeiten',
    labelField: 'Name',
    locationField: 'Ort (optional)',
  },

  wizard: {
    title: 'Neue Box registrieren',
    detailsHeading: 'Wie heißt die Box?',
    detailsHint:
      'Der Name wird auf die Tags geschrieben und in der Benachrichtigung angezeigt.',
    labelPlaceholder: 'z. B. Wohnzimmer-Box',
    locationPlaceholder: 'z. B. Sideboard',
    createAndWrite: 'Box anlegen und Tags beschreiben',
    writeHeading: 'Tag beschreiben',
    writeHint:
      'Halte einen losen NFC-Tag an die Rückseite des Handys. Beschreibe die Tags, bevor du sie festklebst.',
    tagWaiting: 'Warte auf Tag…',
    tagBlank: 'Leerer Tag erkannt.',
    tagOurs: 'Dieser Tag gehört bereits zu einer Time-Served-Box.',
    tagOursHint: 'Beim Beschreiben wird er dieser Box neu zugeordnet.',
    tagForeign: 'Dieser Tag enthält fremde Daten:',
    tagForeignWarn: 'Beim Beschreiben werden die vorhandenen Daten überschrieben.',
    tagLockedForeign: 'Dieser Tag ist schreibgeschützt und kann nicht beschrieben werden.',
    writeButton: 'Tag beschreiben',
    overwriteButton: 'Trotzdem überschreiben',
    writing: 'Schreibe und prüfe…',
    writeVerified: 'Tag erfolgreich beschrieben und geprüft.',
    writeFailed: 'Schreiben fehlgeschlagen. Versuche es erneut.',
    verifyFailed: 'Prüfung fehlgeschlagen. Halte den Tag ruhig ans Handy und versuche es erneut.',
    lockFailed: 'Sperren fehlgeschlagen. Der Tag ist beschrieben, aber nicht gesperrt.',
    tagLost: 'Tag verloren. Halte ihn erneut ans Handy.',
    retry: 'Erneut versuchen',
    lockQuestion: 'Tag dauerhaft gegen Überschreiben sperren?',
    lockWarning:
      'Das kann nicht rückgängig gemacht werden. Ein ungesperrter Tag funktioniert genauso, bleibt aber wiederbeschreibbar.',
    lockConfirm: 'Dauerhaft sperren',
    lockDecline: 'Nicht sperren',
    locking: 'Sperre Tag…',
    locked: 'Tag gesperrt.',
    anotherTagQuestion: 'Weiteren Tag für diese Box beschreiben?',
    anotherTagHint: 'Beide Tags erhalten denselben Inhalt (gegen Antennen-Positionen).',
    anotherTagYes: 'Weiteren Tag beschreiben',
    finish: 'Fertig',
    writtenCount: 'Beschriebene Tags: {count}',
  },

  groups: {
    title: 'Gruppen',
    empty: 'Du bist noch in keiner Gruppe.',
    create: 'Gruppe erstellen',
    join: 'Gruppe beitreten',
    membersCount: '{count} Mitglieder',
    ownerBadge: 'Eigentümer',
    createTitle: 'Neue Gruppe',
    nameField: 'Gruppenname',
    namePlaceholder: 'z. B. Familie',
    nicknameField: 'Dein Nickname in dieser Gruppe',
    nicknamePlaceholder: 'z. B. Jan',
    createButton: 'Gruppe erstellen',
    inviteHeading: 'Einladungslink',
    inviteHint:
      'Teile diesen Link. Der Schlüssel steckt im Link-Fragment und erreicht den Server nie.',
    joinTitle: 'Gruppe beitreten',
    linkField: 'Einladungslink',
    linkPlaceholder: 'https://…/j#g=…&k=…',
    linkInvalid: 'Das ist kein gültiger Einladungslink.',
    consentLabel: 'Diese Gruppe darf meine täglichen Summen sehen',
    consentHint:
      'Es werden nur zwei Zahlen pro Tag geteilt (Tag- und Nacht-Zeit). Sitzungen und Boxen bleiben auf dem Gerät.',
    joinButton: 'Beitreten',
    leaderboardTitle: 'Rangliste',
    periodYesterday: 'Gestern',
    periodWeek: 'Woche',
    periodAllTime: 'Gesamt',
    renameHint: 'Zum lokalen Umbenennen lange drücken.',
    renameTitle: 'Lokal umbenennen',
    renameDescription:
      'Der Name wird nur auf diesem Gerät geändert und nicht geteilt.',
    renamePlaceholder: 'Anzeigename',
    renameReset: 'Zurücksetzen',
    emptyLeaderboard: 'Noch keine versiegelten Tage in diesem Zeitraum.',
    youMarker: '(du)',
    leave: 'Gruppe verlassen',
    leaveConfirm: 'Diese Gruppe wirklich verlassen?',
  },

  settings: {
    title: 'Einstellungen',
    nicknamesHeading: 'Nicknames pro Gruppe',
    timesHeading: 'Zeiten',
    armTimeoutLabel: 'Wartezeit auf Ladekabel',
    armTimeoutHint: 'So lange wartet die App nach dem Tag-Lesen auf das Ladekabel.',
    dayStartLabel: 'Tag beginnt um',
    nightStartLabel: 'Nacht beginnt um',
    sealHourLabel: 'Versiegelung um',
    sealHourHint:
      'Vergangene Tage werden zu dieser Uhrzeit versiegelt und ihre Summen hochgeladen.',
    systemHeading: 'System',
    batteryOptLabel: 'Akku-Optimierung',
    batteryOptUnknown: 'Status unbekannt (wird in der App-Fertigstellung geprüft)',
    syncLabel: 'Synchronisierung',
    syncHint: 'Lädt versiegelte Tages-Summen für deine Gruppen hoch.',
    identityHeading: 'Anonyme Identität',
    identityBlurb:
      'Dein Konto ist eine zufällige ID ohne Bezug zu deinem Gerät oder Namen. Der Server sieht nur versiegelte Tages-Summen; Gruppennamen und Nicknames sind Ende-zu-Ende-verschlüsselt.',
    devHeading: 'Entwicklung',
    openDevHarness: 'Dev-Harness öffnen',
    secondsUnit: 'Sek.',
    oclock: 'Uhr',
  },

  onboarding: {
    skip: 'Überspringen',
    page1Title: 'Zeit absitzen',
    page1Body:
      'Time Served misst, wie lange dein Handy in einer Box liegt — und du ohne es auskommst. Das Ritual: Handy entsperren, Ladekabel anschließen, in die Box legen.',
    page1Steps: ['1. Handy entsperren', '2. Ladekabel anschließen', '3. In die Box legen'],
    page2Title: 'Laden ist das Tor',
    page2Body:
      'Eine Sitzung zählt nur, solange das Handy lädt. Der Stecker ist das ehrliche Signal: Kabel rein — Zeit läuft. Kabel raus — Zeit stoppt. Ohne Kabel zählt nichts.',
    page3Title: 'Zwei Berechtigungen',
    page3Body:
      'Für zuverlässige Sitzungen braucht die App eine dauerhafte Benachrichtigung während der Sitzung und eine Ausnahme von der Akku-Optimierung.',
    page3NotificationButton: 'Benachrichtigungen erlauben',
    page3BatteryButton: 'Akku-Optimierung ausnehmen',
    page3Hint: 'Beides kannst du später in den Einstellungen ändern.',
    page4Title: 'Was geteilt wird',
    page4Body:
      'Wenn du einer Gruppe beitrittst, werden pro Tag genau zwei Zahlen hochgeladen: deine Tag- und Nacht-Zeit — versiegelt am Folgetag um 12:00. Sitzungen, Boxen und dein Standort verlassen das Gerät nie.',
    startButton: 'Los geht’s',
  },

  dev: {
    title: 'Dev-Harness',
    eventsHeading: 'Domain-Events einspeisen',
    tagReadFor: 'TAG_READ: {label}',
    chargingStarted: 'CHARGING_STARTED',
    chargingStopped: 'CHARGING_STOPPED',
    heartbeat: 'HEARTBEAT',
    appResumed: 'APP_RESUMED',
    armTimeout: 'ARM_TIMEOUT',
    clockHeading: 'Zeitreise (Fake-Clock-Offset)',
    plusHour: '+1 Stunde',
    plusDay: '+1 Tag',
    resetClock: 'Offset zurücksetzen',
    stateHeading: 'Zustand',
    machineState: 'State-Machine',
    openSessions: 'Offene Sitzungen',
    dirtyBuckets: 'Dirty Buckets',
    clockNow: 'Clock',
    clockOffset: 'Offset',
    refresh: 'Aktualisieren',
    noBoxes: 'Keine Boxen vorhanden — erst eine Box registrieren.',
    tagPresentHeading: 'Wizard: Tag präsentieren',
    presentBlank: 'Leeren Tag präsentieren',
    presentOurs: 'Eigenen Tag präsentieren',
    presentForeign: 'Fremden Tag präsentieren',
    presentLockedForeign: 'Gesperrten fremden Tag präsentieren',
  },
} as const;

/** Replace `{name}` placeholders — the one formatting helper the strings need. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = values[key];
    return value === undefined ? match : String(value);
  });
}
