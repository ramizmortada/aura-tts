let creatingOffscreen: Promise<void> | null = null;

async function setupOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) return;
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }
  creatingOffscreen = chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
    justification: "To play text-to-speech audio streams."
  });
  await creatingOffscreen;
  creatingOffscreen = null;
}

let activeClientPort: chrome.runtime.Port | null = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Forward offscreen playback events to the active content script port
  if (msg.type === "PLAYBACK_ENDED" || msg.type === "TIME_UPDATE") {
    if (activeClientPort) {
      try {
        activeClientPort.postMessage(msg);
      } catch (e) {
        // Port disconnected
      }
    }
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "tts-stream") return;

  let nativePort: chrome.runtime.Port | null = null;
  let isActive = true;
  let isSessionPort = false;

  port.onDisconnect.addListener(() => {
    isActive = false;
    if (activeClientPort === port) {
      activeClientPort = null;
    }
    // Only stop offscreen audio if this was the port that started a session
    if (isSessionPort) {
      chrome.runtime.sendMessage({ target: "offscreen", type: "STOP" }).catch(()=>{});
    }
    if (nativePort) {
      nativePort.disconnect();
      nativePort = null;
    }
  });

  port.onMessage.addListener(async (msg) => {
    if (msg.type === "START") {
      // This port is now the active session port
      isSessionPort = true;
      activeClientPort = port;

      try {
        await setupOffscreenDocument();
        chrome.runtime.sendMessage({ target: "offscreen", type: "INIT_AUDIO" }).catch(()=>{});

        // Connect to the native messaging host
        nativePort = chrome.runtime.connectNative("com.edgetts.host");
        
        nativePort.onDisconnect.addListener(() => {
          if (chrome.runtime.lastError) {
            console.error("Native host disconnected:", chrome.runtime.lastError);
            if (isActive) {
              port.postMessage({ type: "error", error: "Native host disconnected. Did you run install.bat and set the correct extension ID?" });
            }
          }
        });

        nativePort.onMessage.addListener((nativeMsg) => {
          if (!isActive) return;

          if (nativeMsg.type === "audio") {
             chrome.runtime.sendMessage({ target: "offscreen", type: "APPEND_AUDIO", data: nativeMsg.data }).catch(()=>{});
          } else if (nativeMsg.type === "WordBoundary") {
             port.postMessage({
               type: "WordBoundary",
               offset: nativeMsg.offset,
               duration: nativeMsg.duration,
               textObj: nativeMsg.textObj
             });
          } else if (nativeMsg.type === "end") {
             port.postMessage({ type: "end" });
             chrome.runtime.sendMessage({ target: "offscreen", type: "END_STREAM" }).catch(()=>{});
             nativePort?.disconnect();
          } else if (nativeMsg.type === "error") {
             port.postMessage({ type: "error", error: nativeMsg.error });
             chrome.runtime.sendMessage({ target: "offscreen", type: "STOP" }).catch(()=>{});
             nativePort?.disconnect();
          }
        });

        // Forward the START message to the native host
        nativePort.postMessage({
          type: "START",
          text: msg.text,
          voice: msg.voice,
          rateString: msg.rateString
        });
        
      } catch (error: any) {
        if (isActive) {
          port.postMessage({ type: "error", error: error.message || error.toString() });
        }
      }
    } else if (msg.type === "PLAY") {
      chrome.runtime.sendMessage({ target: "offscreen", type: "PLAY" }).catch(()=>{});
    } else if (msg.type === "PAUSE") {
      chrome.runtime.sendMessage({ target: "offscreen", type: "PAUSE" }).catch(()=>{});
    } else if (msg.type === "STOP") {
      chrome.runtime.sendMessage({ target: "offscreen", type: "STOP" }).catch(()=>{});
      if (nativePort) {
        nativePort.disconnect();
        nativePort = null;
      }
    } else if (msg.type === "SEEK") {
      chrome.runtime.sendMessage({ target: "offscreen", type: "SEEK", offset: msg.offset }).catch(()=>{});
    }
  });
});
