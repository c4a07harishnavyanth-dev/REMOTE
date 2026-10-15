import { connectRoom } from "./app.js";

const roomPattern = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const createPlayerId = () => {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

export function startController(inputRoom) {
  const room = typeof inputRoom === "string" ? inputRoom.toUpperCase() : "";
  const roomCode = document.querySelector("#controller-room-code");
  const enableButton = document.querySelector("#enable-sensors");
  const motionToggle = document.querySelector("#motion-toggle");
  const calibrateButton = document.querySelector("#calibrate");
  const touchSteering = document.querySelector("#touch-steering");
  const steerLeftButton = document.querySelector("#steer-left");
  const steerRightButton = document.querySelector("#steer-right");
  const jumpButton = document.querySelector("#jump-button");
  const boostButton = document.querySelector("#boost-button");
  const brakeButton = document.querySelector("#brake-button");
  const sensorTitle = document.querySelector("#sensor-title");
  const sensorDescription = document.querySelector("#sensor-description");
  const sensorMessage = document.querySelector("#sensor-message");
  const neutralLabel = document.querySelector("#neutral-label");
  const steeringDot = document.querySelector("#steering-dot");
  const connection = document.querySelector("#controller-connection");
  const connectionLabel = document.querySelector("#controller-connection-label");
  const latencyLabel = document.querySelector("#controller-latency");
  const roomEntry = document.querySelector("#room-entry");
  const roomEntryForm = document.querySelector("#room-entry-form");
  const roomEntryCode = document.querySelector("#room-entry-code");
  const roomEntryMessage = document.querySelector("#room-entry-message");
  const controlledViews = [
    document.querySelector(".controller-welcome"),
    document.querySelector("#sensor-card"),
    document.querySelector("#steering-card"),
    document.querySelector("#phone-actions"),
    document.querySelector("#controller-footer"),
    document.querySelector(".fine-print")
  ];
  const buttons = [jumpButton, boostButton, brakeButton];
  const playerId = sessionStorage.getItem("tilt-racer-player-id") || createPlayerId();
  sessionStorage.setItem("tilt-racer-player-id", playerId);
  const name = { id: playerId, display: `Driver ${playerId.slice(0, 2).toUpperCase()}` };

  if (!roomPattern.test(room)) {
    roomCode.textContent = "······";
    roomEntry.hidden = false;
    for (const view of controlledViews) {
      view.hidden = true;
    }
    roomEntryForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const code = roomEntryCode.value.trim().toUpperCase();
      if (!roomPattern.test(code)) {
        roomEntryMessage.textContent = "Enter the six letters and numbers shown on the game screen.";
        return;
      }
      const destination = new URL(location.href);
      destination.searchParams.set("mode", "controller");
      destination.searchParams.set("room", code);
      location.assign(destination);
    });
    connectionLabel.textContent = "Room code needed";
    connection.classList.remove("connected");
    return;
  }

  roomEntry.hidden = true;
  roomCode.textContent = room;
  let neutralGamma = null;
  let filteredTilt = 0;
  let throttle = 0;
  let brake = false;
  let jumpUntil = 0;
  let lastShakeAt = 0;
  let previousAcceleration = null;
  let latency = null;
  let socketReady = false;
  let sensorReady = false;
  let controlsReady = false;
  let motionEnabled = true;
  let touchTilt = 0;
  let gotOrientation = false;
  let hasMotionEvent = false;
  let lastGamma = null;

  const updateIndicator = () => {
    const steering = motionEnabled ? filteredTilt : touchTilt;
    steeringDot.style.left = `${50 + steering * 43}%`;
  };
  const setMessage = (message) => {
    sensorMessage.textContent = message;
  };
  const armJump = (vibrate = false) => {
    jumpUntil = Date.now() + 350;
    if (vibrate && navigator.vibrate) {
      navigator.vibrate(35);
    }
  };
  const onOrientation = (event) => {
    if (!motionEnabled || !Number.isFinite(event.gamma)) {
      return;
    }
    gotOrientation = true;
    lastGamma = event.gamma;
    setMessage("");
    if (neutralGamma === null) {
      neutralGamma = event.gamma;
      neutralLabel.textContent = "CALIBRATED";
      calibrateButton.disabled = false;
    }
    const tilt = clamp((event.gamma - neutralGamma) / 24, -1, 1);
    filteredTilt += (tilt - filteredTilt) * 0.2;
    updateIndicator();
  };
  const onMotion = (event) => {
    if (!motionEnabled) {
      return;
    }
    hasMotionEvent = true;
    setMessage("");
    const acceleration = event.acceleration;
    let strength = 0;
    if (acceleration && [acceleration.x, acceleration.y, acceleration.z].every(Number.isFinite)) {
      strength = Math.hypot(acceleration.x, acceleration.y, acceleration.z);
    } else if (event.accelerationIncludingGravity) {
      const current = event.accelerationIncludingGravity;
      if ([current.x, current.y, current.z].every(Number.isFinite) && previousAcceleration) {
        strength = Math.hypot(
          current.x - previousAcceleration.x,
          current.y - previousAcceleration.y,
          current.z - previousAcceleration.z
        );
      }
      previousAcceleration = current;
    }
    if (strength > 15 && Date.now() - lastShakeAt > 850) {
      lastShakeAt = Date.now();
      armJump(true);
    }
  };

  const controller = connectRoom(room, "controller", name, (message) => {
    if (message.type === "pong") {
      latency = Math.max(0, Date.now() - message.sentAt);
      latencyLabel.textContent = `${latency} ms`;
    }
    if (message.type === "joined") {
      sensorDescription.textContent = "Tilt to steer · shake or tap to jump · hold boost to accelerate.";
    }
  }, (connected, detail) => {
    socketReady = connected;
    connection.classList.toggle("connected", connected);
    connectionLabel.textContent = connected ? "Connected to the grid" : detail || "Reconnecting to the grid…";
  });

  const transmit = setInterval(() => {
    if (!socketReady) {
      return;
    }
    controller.send({
      type: "control",
      tilt: motionEnabled ? filteredTilt : touchTilt,
      throttle,
      brake,
      jump: Date.now() < jumpUntil,
      sentAt: Date.now()
    });
  }, 33);

  const bindHoldButton = (button, setValue) => {
    button.addEventListener("pointerdown", (event) => {
      if (!controlsReady) {
        return;
      }
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      button.classList.add("is-active");
      setValue(true);
    });
    const release = () => {
      button.classList.remove("is-active");
      setValue(false);
    };
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("lostpointercapture", release);
    button.addEventListener("contextmenu", (event) => event.preventDefault());
  };

  bindHoldButton(boostButton, (active) => { throttle = active ? 1 : 0; });
  bindHoldButton(brakeButton, (active) => { brake = active; });
  jumpButton.addEventListener("pointerdown", (event) => {
    if (!controlsReady) {
      return;
    }
    event.preventDefault();
    armJump(true);
    jumpButton.classList.add("is-active");
    jumpButton.setPointerCapture(event.pointerId);
  });
  jumpButton.addEventListener("pointerup", () => jumpButton.classList.remove("is-active"));
  jumpButton.addEventListener("pointercancel", () => jumpButton.classList.remove("is-active"));
  jumpButton.addEventListener("lostpointercapture", () => jumpButton.classList.remove("is-active"));

  const setTouchMode = () => {
    if (sensorReady) {
      window.removeEventListener("deviceorientation", onOrientation);
      window.removeEventListener("devicemotion", onMotion);
      sensorReady = false;
    }
    motionEnabled = false;
    controlsReady = true;
    filteredTilt = 0;
    touchTilt = 0;
    throttle = 0;
    brake = false;
    neutralGamma = null;
    lastGamma = null;
    previousAcceleration = null;
    updateIndicator();
    touchSteering.hidden = false;
    steerLeftButton.disabled = false;
    steerRightButton.disabled = false;
    for (const button of buttons) {
      button.disabled = false;
    }
    calibrateButton.disabled = true;
    neutralLabel.textContent = "TOUCH STEERING";
    sensorTitle.textContent = "Touch steering ready";
    sensorDescription.textContent = "Hold left or right to steer. Tap jump; hold boost or brake.";
    enableButton.disabled = false;
    enableButton.textContent = "Enable motion controls";
    setMessage("");
  };

  const bindSteeringButton = (button, direction) => {
    const release = () => {
      button.classList.remove("is-active");
      touchTilt = 0;
      updateIndicator();
    };
    button.addEventListener("pointerdown", (event) => {
      if (!controlsReady || motionEnabled) {
        return;
      }
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      button.classList.add("is-active");
      touchTilt = direction;
      updateIndicator();
    });
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("lostpointercapture", release);
  };

  bindSteeringButton(steerLeftButton, -1);
  bindSteeringButton(steerRightButton, 1);

  const enableMotionControls = async () => {
    if (sensorReady) {
      return;
    }
    motionToggle.disabled = true;
    enableButton.disabled = true;
    controlsReady = false;
    motionEnabled = false;
    touchSteering.hidden = true;
    steerLeftButton.disabled = true;
    steerRightButton.disabled = true;
    for (const button of buttons) {
      button.disabled = true;
    }
    setMessage("");
    try {
      if (!window.isSecureContext) {
        throw new Error("Motion sensors need a secure HTTPS page. Open the game over HTTPS and scan its QR code again.");
      }
      const permissionRequests = [];
      if (typeof DeviceOrientationEvent === "undefined") {
        throw new Error("This browser does not expose a motion-orientation sensor.");
      }
      if (typeof DeviceOrientationEvent.requestPermission === "function") {
        permissionRequests.push(DeviceOrientationEvent.requestPermission());
      }
      if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
        permissionRequests.push(DeviceMotionEvent.requestPermission());
      }
      const permissions = await Promise.all(permissionRequests);
      if (permissions.some((permission) => permission !== "granted")) {
        throw new Error("Motion access was not granted. Allow it in your browser settings and try again.");
      }
      window.addEventListener("deviceorientation", onOrientation);
      window.addEventListener("devicemotion", onMotion);
      sensorReady = true;
      motionEnabled = true;
      controlsReady = true;
      touchTilt = 0;
      updateIndicator();
      for (const button of buttons) {
        button.disabled = false;
      }
      calibrateButton.disabled = true;
      neutralLabel.textContent = "NOT CALIBRATED";
      enableButton.textContent = "Motion controls enabled";
      enableButton.textContent += " ✓";
      sensorTitle.textContent = "Sensors are live";
      sensorDescription.textContent = "Hold the phone upright, then set your neutral position.";
      motionToggle.disabled = false;
      setTimeout(() => {
        if (!gotOrientation) {
          setMessage("No orientation readings yet. Check that this page is HTTPS and motion access is allowed.");
        } else if (!hasMotionEvent) {
          setMessage("Steering is ready; your browser does not currently provide shake readings.");
        }
      }, 2500);
    } catch (error) {
      motionToggle.checked = false;
      setTouchMode();
      sensorTitle.textContent = "Motion access unavailable";
      setMessage(error.message || "Could not enable motion controls.");
    }
  };

  enableButton.addEventListener("click", () => {
    motionToggle.checked = true;
    void enableMotionControls();
  });
  motionToggle.addEventListener("change", () => {
    if (motionToggle.checked) {
      void enableMotionControls();
    } else {
      setTouchMode();
    }
  });

  if (!motionToggle.checked) {
    setTouchMode();
  }

  calibrateButton.addEventListener("click", () => {
    if (!gotOrientation || !Number.isFinite(lastGamma)) {
      setMessage("Hold the phone in your preferred neutral position and wait for an orientation reading.");
      return;
    }
    neutralGamma = lastGamma;
    filteredTilt = 0;
    touchTilt = 0;
    updateIndicator();
    neutralLabel.textContent = "CALIBRATED";
    setMessage("Neutral position saved. Tilt either way to steer.");
  });

  window.addEventListener("pagehide", () => {
    clearInterval(transmit);
    controller.close();
  }, { once: true });
}
