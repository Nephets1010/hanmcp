# VHS tape for the 30-second demo GIF.
#
#   vhs docs/demo.tape
#
# Requires vhs (https://github.com/charmbracelet/vhs) and ffmpeg.
# Storyboard, shot timings and recording checklist: docs/DEMO.md
#
# Font note: this tape asks for a font family with real CJK coverage. A font
# without it (JetBrains Mono, Fira Code, Cascadia Code) will fall back to a
# different typeface for the Chinese text, or render tofu boxes. Install one of
# the alternatives below before recording.

Output docs/demo.gif

Set Shell bash
Set FontFamily "Sarasa Mono SC, Noto Sans Mono CJK SC, Source Han Mono, monospace"
Set FontSize 18
Set Width 1200
Set Height 700
Set Padding 24
Set MarginFill "#0d1117"
Set BorderRadius 8
Set Theme "GitHub Dark"
Set TypingSpeed 60ms
Set Framerate 30
Set PlaybackSpeed 1.0

Hide
Type "cd $(git rev-parse --show-toplevel)"
Enter
Sleep 500ms
Type "clear"
Enter
Sleep 300ms
Show

# Shot 1 — the command. `npm run demo` is the paced form, which is what makes
# shots 2-6 land; the bare `node demo/run-demo.js` prints the same output with
# no holds and records badly.
Type "npm run demo"
Sleep 400ms
Enter

# Shots 2-6 are paced by run-demo.js and take about 27s. Leave a couple of
# seconds of margin: if this is short the GIF loses the closing hold, and a
# static extra frame at the end costs almost nothing.
Sleep 29s
