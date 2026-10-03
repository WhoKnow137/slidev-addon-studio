---
layout: default
---

Ordinary Markdown before the text.

<StudioText version="1" id="word-test" pos="120,220,1200,auto" resize="auto-height" :rotate="0" font-family="sans-serif" :font-size="64" font-weight="400" font-style="normal" color="#111111" line-height="normal" letter-spacing="0" align="left" vertical-align="top">Hello <StudioRun font-size="72" color="#ff3344">world</StudioRun></StudioText>

<StudioText version="1" id="other-text" pos="120,340,1200,auto" resize="auto-height" :font-size="32" color="#111111">Another text object.</StudioText>

<StudioText version="1" id="unsupported-text" pos="120,440,1200,auto" resize="auto-height" :font-size="32" color="#111111">Unsupported <span style="color:red">markup</span> remains visible.</StudioText>

<!--
Presenter notes must remain byte-identical.
-->
