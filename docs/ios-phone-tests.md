# iPhone tests for branch `ios-followups`

**None of this has run on a phone yet.** The code compiles and its logic tests pass, but only a real iPhone can show how audio behaves. Run these before you lead a set with this build. They take about 30 minutes.

Tests 1 and 4 matter most. If either fails, don't use this build for a set.

## Before you start

- Install the build the usual way, and import Way Maker (`.djw` and recording).
- Have Apple Music or Spotify ready to play.
- Have headphones, and a second phone that can call this one.

## Tests

### 1. Sound starts every way it can

This is the riskiest change. Audio now rests when nothing plays and has to wake without trouble.

1. Force-quit the app and open it.
2. Tap a tab, then press Play on a song's Tap screen. You should hear it right away.
3. Preview a pad in Library. You should hear it.
4. Start a set in Perform. You should hear it.
5. Start Practice, which opens on a pad. You should hear it.

If any of these is silent, or a set pauses itself right after it starts, stop and report which one. The app can't yet tell whether WebKit, the web view's engine, shares the app's audio session, so this is where a wrong guess shows up.

### 2. Other apps' music is left alone until you play

1. Start music in Apple Music or Spotify, then open Lamp Circle. The music should keep playing.
2. Tap around and scroll. The music should keep playing.
3. Press Play on a song. The other music should stop, and Lamp Circle should play.
4. Pause, then wait 20 seconds. The other app should be able to play again. Spotify may restart on its own. Apple Music may wait for you to press play.

### 3. The silent switch

Turn the ring/silent switch to silent and start a set. You should still hear it.

### 4. The locked screen and the background

This is the biggest unknown. Other apps report that a web view can stop this kind of audio in the background, even with every setting right.

1. Start a set in Perform, and press the side button to lock the phone.
2. Listen for at least a minute, past the next section change. The music should keep going and the sections should keep changing.
3. Unlock the phone. The screen should show the right section.
4. Repeat, swiping home to leave the app instead of locking.

If the music stops, lead with the app open and the phone unlocked. Perform already keeps the screen on, so the phone won't lock by itself. A real fix means moving playback out of the web view, which is a much bigger job.

### 5. The first note

With no other music playing, start a set a few times from a fresh launch. The first sound should come quickly and cleanly, with no click, dropout or long wait. Report anything you hear.

### 6. A phone call

1. During a song, call this phone from the other phone. The set should pause within about a second and show as paused.
2. Decline the call. The set should stay paused. It never restarts by itself.
3. Tap to resume. It should play from the same spot, with sound.
4. Repeat, answering the call and then hanging up.

### 7. Headphones and the sound desk cable

1. Play through headphones, wired or Bluetooth.
2. Unplug them or turn them off. It should pause at once, with at most a blip from the speaker.
3. Tap to resume. It should play from the speaker.

### 8. A long pause

1. Start music in another app, then start a set, which stops that music.
2. Pause the set and wait 2 minutes. The other app should stay quiet.
3. Leave Perform and wait 20 seconds. The other app should be able to play again.

### 9. The icon

Look at the home screen, the search results and Settings. You should see the lantern on cream, with no white or black edge.

### 10. Opening a `.djw` from outside

1. AirDrop a `.djw` to the phone and choose Lamp Circle. Library should open with the map waiting for its recording.
2. Do the same with the app force-quit first.
3. In the Files app, tap a `.djw`. It won't jump straight into the app. Use Share, then Lamp Circle. Library should open with the map waiting for its recording.

### 11. The next TestFlight upload

Watch for an App Store Connect warning about document types. This branch replaces `UISupportsDocumentBrowser` with `LSSupportsOpeningDocumentsInPlace = NO`. Apple's check should accept that, but no upload has tried it yet.

### 12. The Settings sheet

Tap the Settings tab, at the right of the bottom bar. The sheet should fill the screen, clear of the notch and the home bar, with Done at the top right.

1. **Theme.** Change Appearance to Light, Dark and Auto. The whole app should change behind the sheet.
2. **Back up, and check the file.** This is the only copy of a library that lives on one phone, so check it properly.
   1. Tap **Back up library**. The percent should climb, then the save dialog should open.
   2. Save to iCloud Drive or On My iPhone. The sheet should say **Saved**, and the file in the Files app should be about the size of your library.
   3. Tap it again and cancel the dialog. The sheet should say the backup was cancelled.
   4. If the app goes blank or restarts during a large backup, stop and report the library's size. A backup needs free space of about twice the library until it's saved, or the sheet should say there's no space.
3. **Restore.** Remove one song from Library, then tap **Restore from a backup** and pick the file you saved.
   1. The sheet should say what it added, and the song should play with its sound.
   2. Pick the same file again. It should say there is nothing new to add.
   3. Pick a file that isn't a backup. It should say so, and change nothing.
   4. If the backup file is greyed out in the picker, stop and report it.
4. **Feedback.** Tap **Send feedback**, write a test note and tap Send. The keyboard should not hide the note. A test build without the relay address should say feedback isn't set up.
5. **The rest.** About should show this build's version. Turn a Privacy box off, close the sheet and reopen it. The box should still be off. Set **When Lamp Circle opens** to Start at the Library, then force-quit and reopen. It should open on Library.

## Why a tap in Files doesn't open the app

Opening in place would need `LSSupportsOpeningDocumentsInPlace = YES`, and that can't work with Tauri's current window library, tao 0.37:

- When a file launches the app, tao ignores the file's address.
- When the app is already running, tao turns the address into plain text, which drops the permission needed to read the file.

With `NO`, iOS copies the file into the app's `Documents/Inbox` first, and the app reads it from there. To get the one-tap open, tao has to fix both problems.

## Before you lead

A call still pauses the set. Turn on Airplane Mode or Do Not Disturb before you start.
