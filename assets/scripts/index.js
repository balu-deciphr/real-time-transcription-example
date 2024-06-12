// required dom elements
const inputEl = document.getElementById("button");
const messageEl = document.getElementById("message");
const titleEl = document.getElementById("real-time-title");

// set initial state of application variables
messageEl.style.display = "none";

let isRecording = false;
let rt;
let audio;

const mergeBuffers = (lhs, rhs) => {
  const mergedBuffer = new Int16Array(lhs.length + rhs.length);

  mergedBuffer.set(lhs, 0);
  mergedBuffer.set(rhs, lhs.length);

  return mergedBuffer;
};

export const createAudioStream = () => {
  let stream;
  let audioContext;
  let audioWorkletNode;
  let source;
  let audioBufferQueue = new Int16Array(0);

  return {
    init: (src) => {
      stream = src;
    },

    startRecording: async (onAudio) => {
      if (!stream) {
        throw new Error("Audio stream not found");
      }

      audioContext = new AudioContext({ sampleRate: 16_000, latencyHint: "balanced" });
      source = audioContext.createMediaStreamSource(stream);

      await audioContext.audioWorklet.addModule("/worklet/audio-processor.js");

      audioWorkletNode = new AudioWorkletNode(audioContext, "audio-processor");

      source.connect(audioWorkletNode);
      audioWorkletNode.connect(audioContext.destination);

      audioWorkletNode.port.onmessage = (event) => {
        const currentBuffer = new Int16Array(event.data.audio_data);
        let bufferDuration;

        audioBufferQueue = mergeBuffers(audioBufferQueue, currentBuffer);
        bufferDuration = (audioBufferQueue.length / audioContext.sampleRate) * 1000;

        if (bufferDuration >= 100) {
          const totalSamples = Math.floor(audioContext.sampleRate * 0.1);
          const finalBuffer = new Uint8Array(audioBufferQueue.subarray(0, totalSamples).buffer);

          audioBufferQueue = audioBufferQueue.subarray(totalSamples);

          if (onAudio) {
            onAudio(finalBuffer);
          }
        }
      };
    },

    stopRecording: () => {
      stream?.getTracks().forEach((track) => track.stop());
      audioContext?.close();

      audioBufferQueue = new Int16Array(0);
    },
  };
};
///////


// runs real-time transcription and handles global variables
const run = async () => {
  if (isRecording) {
    if (rt) {
      await rt.close(false);

      rt = null;
    }

    if (audio) {
      audio.pause();

      audio = null;
    }
  }

  const mediaFile = document.getElementById("file").files[0];
  const objectURL = window.URL.createObjectURL(mediaFile);
  let audioStream = null;
  let canCaptureStream = false;

  audio = new Audio(objectURL);
  audioRecordStream = createAudioStream();

  if (audio.mozCaptureStream) {
    canCaptureStream = true;
    stream = audio.mozCaptureStream();
  } else if (audio.captureStream) {
    canCaptureStream = true;
    stream = audio.captureStream();
  }

  if (canCaptureStream) {
    audio.volume = 0.5;

    await audio.play();

    audioRecordStream.init(stream);

    try {
      await initSocketConnection(token);

      await audioRecordStream.startRecording((audioData) => {
        rt.sendAudio(audioData);
      });
    } catch (e) {
      console.error("Socket connection failed: ", e);
    }
  }

  // TODO: You have to get a RTT session token from Assembly AI. It must be implemented in the backend.
  // Below is a sample python code for how you can do this:
  /*
    def get_one_time_token(
        expires_in: int = 3600
) -> str:
    """Gets a one time token for assembly.ai

    Args:
        expires_in (int, optional): The time in seconds before the token expires. Defaults to 3600.

    Returns:
        str: The one time token
    """
    token_endpoint = "https://api.assemblyai.com/v2/realtime/token"
    json_payload = {'expires_in': expires_in}
    headers = {"authorization": os.getenv("ASSEMBLYAI_KEY")}
    response = requests.post(
        token_endpoint,
        headers=headers,
        json=json_payload,
        timeout=60
    )
    return response.json()["token"]
  */
  const response = await fetch("/token");
  const data = await response.json(); // Assumes that the response from the backend is: { token: "<token>" }

  if (data.error) {
    alert(data.error);
    return;
  }

  rt = new assemblyai.RealtimeService({ token: data.token });
  // handle incoming messages to display transcription to the DOM
  const texts = {};
  rt.on("transcript", (message) => {
    let msg = "";

    texts[message.audio_start] = message.text;

    const keys = Object.keys(texts);

    keys.sort((a, b) => a - b);

    for (const key of keys) {
      if (texts[key]) {
        msg += ` ${texts[key]}`;
      }
    }

    messageEl.innerText = msg;
  });

  rt.on("error", async (error) => {
    console.error(error);

    await rt.close();
  });

  rt.on("close", (event) => {
    console.log(event);

    rt = null;
  });

  await rt.connect();
  // once socket is open, begin recording
  messageEl.style.display = "";

  await audioStream.startRecording((audioData) => {
    rt.sendAudio(audioData);
  });

  isRecording = !isRecording;
};

buttonEl.addEventListener("change", () => run());
