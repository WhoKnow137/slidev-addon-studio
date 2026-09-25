---
layout: default
---

Ordinary Markdown before the text.

<StudioText version="1" id="type-test" pos="120,220,1200,auto" resize="auto-height" :rotate="0" font-family="Inter Tight" :font-size="70" font-weight="700" font-style="normal" color="#224466" line-height="1.2" letter-spacing="-1.5px" text-case="uppercase" align="center" vertical-align="bottom"><StudioRun font-size="80">Hello </StudioRun><StudioRun font-size="80" font-weight="400" color="#ff3344" decoration="underline">world</StudioRun></StudioText>

<StudioText version="1" id="other-text" pos="120,340,1200,auto" resize="auto-height" :font-size="32">Unrelated object.</StudioText>

<StudioText version="1" id="unsupported-text" pos="120,440,1200,auto" resize="auto-height" :font-size="32">Unsupported <span style="color:red">markup</span> remains visible.</StudioText>

<StudioText version="1" id="decoration-test" pos="120,540,1200,auto" resize="auto-height" :font-size="32" decoration="underline">Base <StudioRun decoration="none">off</StudioRun></StudioText>

<StudioText version="1" id="vertical-test" pos="120,640,500,180" resize="fixed" :font-size="32" vertical-align="top">VERTICAL</StudioText>

<!--
Synthetic speaker notes remain unchanged.
-->
