// Core constants and helpers
const MessageType = {
  mfdStatus: 16,
  mfdControl: 17,
  channelInfo: 32,
  channelCmd: 33,
  systemCmd: 48,
  systemReq: 49,
  systemWrite: 50,
  acknowledgement: 128,
  subscriptionRequest: 96,
};

const SystemCommand = {
  wduInfo: 1,
  wduHeartbeat: 5,
};

const AcknowledgementCommand = {
  acknowledgementAck: 0,
};

const ChannelCommand = {
  toggle: 0,
  momentary: 1,
  dimmerUpdate: 3,
  statusUpdate: 5,
};

const DeviceCommands = {
  receivedWduHeartbeatAck: function () {
    return {
      messagetype: MessageType.acknowledgement,
      messagecmd: AcknowledgementCommand.acknowledgementAck,
      size: 1,
      data: [0],
    };
  },
  requestWduInfo: function () {
    return {
      messagetype: MessageType.systemReq,
      messagecmd: SystemCommand.wduInfo,
      size: 3,
      data: [0, 0, 0],
    };
  },
  momentary: function (channelId, state) {
    return {
      messagetype: 17,
      messagecmd: 1,
      size: 3,
      data: [channelId & 0xff, (channelId >> 8) & 0xff, state ? 1 : 0],
    };
  },
  dimmer: function (channelId, level) {
    const value = Math.max(0, Math.min(1000, level)); // clamp to 0–1000
    const valueLow = value & 0xff;
    const valueHigh = (value >> 8) & 0xff;
    const statusByte = 0; // 0 = ON, 1 = OFF — based on reference app

    return {
      messagetype: MessageType.mfdControl,
      messagecmd: ChannelCommand.dimmerUpdate,
      size: 5,
      data: [
        channelId & 0xff, // byte 0
        (channelId >> 8) & 0xff, // byte 1
        statusByte, // byte 2 (on/off)
        valueLow, // byte 3 (dimmer level low byte)
        valueHigh, // byte 4 (dimmer level high byte)
      ],
    };
  },
};

// Global variables
let wsSocket = null;
let signalStateMap = new Map();
let debugEnabled = false;

// Initialize when DOM is loaded
document.addEventListener("DOMContentLoaded", function () {
  // Setup WebSocket connection
  setupWebSocketClient();

  // Add event listeners for buttons
  setupButtonListeners();

  // Create connection status indicator
  createStatusIndicator();

  // Setup debug UI toggle
  setupDebugToggle();
  // Check pulse button states more frequently (e.g., every 500ms)
  setupPulseButtonUpdater();
});

// Toggle debug UI functionality
function toggleDebugUI(forceState) {
  debugEnabled = typeof forceState === "boolean" ? forceState : !debugEnabled;

  // Check if debug elements exist, and create them if they don't
  ensureDebugElementsExist();

  // Toggle visibility
  var debugElements = document.querySelectorAll(".debug-section");
  for (var i = 0; i < debugElements.length; i++) {
    debugElements[i].style.display = debugEnabled ? "block" : "none";
  }

  console.log("Debug mode " + (debugEnabled ? "enabled" : "disabled"));
}

function ensureDebugElementsExist() {
  // Create debug container if it doesn't exist
  if (!document.getElementById("debug-container")) {
    var container = document.createElement("div");
    container.id = "debug-container";
    container.className = "debug-section";
    container.style.display = "none";
    container.style.marginTop = "30px";
    container.style.padding = "10px";
    container.style.border = "1px solid #444";
    container.style.borderRadius = "4px";

    // Create log section
    var logSection = document.createElement("div");
    logSection.id = "wsLog";
    logSection.style.height = "200px";
    logSection.style.overflow = "auto";
    logSection.style.border = "1px solid #333";
    logSection.style.padding = "5px";
    logSection.style.marginTop = "10px";
    logSection.style.fontFamily = "monospace";
    logSection.style.fontSize = "12px";

    // Create heading
    var heading = document.createElement("h4");
    heading.textContent = "Debug Console";

    container.appendChild(heading);
    container.appendChild(logSection);
    document.body.appendChild(container);
  }
}

function setupDebugToggle() {
  // Listen for keyboard shortcut
  document.addEventListener("keydown", function (e) {
    if (e.altKey && e.shiftKey && e.code === "KeyD") {
      toggleDebugUI();
    }
  });

  // Enable long press on title for mobile
  var header = document.querySelector("h2");
  if (header) {
    var touchTimer = null;

    function startTimer() {
      touchTimer = setTimeout(function () {
        toggleDebugUI();
      }, 3000);
    }

    function cancelTimer() {
      if (touchTimer) {
        clearTimeout(touchTimer);
        touchTimer = null;
      }
    }

    header.addEventListener("mousedown", startTimer);
    header.addEventListener("mouseup", cancelTimer);
    header.addEventListener("mouseleave", cancelTimer);
    header.addEventListener("touchstart", startTimer);
    header.addEventListener("touchend", cancelTimer);
    header.addEventListener("touchcancel", cancelTimer);
  }
}

// WS client setup
function setupWebSocketClient() {
  const url = "ws://" + window.location.hostname + ":8888/ws";
  let lastHeartbeatTime = 0;
  let fallbackInterval = null;

  function log(msg) {
    console.log("[" + new Date().toLocaleTimeString() + "] " + msg);

    // Also log to debug UI if it's enabled
    if (debugEnabled) {
      var logDiv = document.getElementById("wsLog");
      if (logDiv) {
        var entry = document.createElement("div");
        entry.textContent = "[" + new Date().toLocaleTimeString() + "] " + msg;
        logDiv.appendChild(entry);
        logDiv.scrollTop = logDiv.scrollHeight;
      }
    }
  }

  function sendAck() {
    if (wsSocket && wsSocket.readyState === WebSocket.OPEN) {
      wsSocket.send(JSON.stringify(DeviceCommands.receivedWduHeartbeatAck()));
      log("Sent heartbeat ACK");
    }
  }

  function sendInfoRequest() {
    if (wsSocket && wsSocket.readyState === WebSocket.OPEN) {
      wsSocket.send(JSON.stringify(DeviceCommands.requestWduInfo()));
      log("Sent info request");
    }
  }

  function setupWatchdog() {
    if (fallbackInterval) {
      clearInterval(fallbackInterval);
    }
    fallbackInterval = setInterval(function () {
      if (Date.now() - lastHeartbeatTime > 10000) {
        sendInfoRequest();
      }
    }, 5000);
  }

  wsSocket = new WebSocket(url);

  wsSocket.onopen = function () {
    log("Connected");
    updateConnectionStatus(true);
    setupWatchdog();

    // If the subscription script exists, send it
    const script = document.getElementById("mfd-channel-subscription");
    if (script) {
      wsSocket.send(script.textContent);
      try {
        const parsed = JSON.parse(script.textContent);
        log(
          "Sent subscription request for " + parsed.data.length / 2 + " signals"
        );
      } catch (e) {
        log("Error parsing subscription data: " + e.message);
      }
    }
  };

  wsSocket.onmessage = function (event) {
    log("Raw WS Message: " + event.data);
    try {
      const msg = JSON.parse(event.data);
      if (msg.messagetype === 48 && msg.messagecmd === 5) {
        lastHeartbeatTime = Date.now();
        sendAck();
        log("Heartbeat received");
      }

      // Handle button state updates
      // Updated to handle both messagecmd 0 and 1
      if (
        msg.messagetype === MessageType.mfdStatus &&
        (msg.messagecmd === 0 || msg.messagecmd === 1)
      ) {
        if (msg.data && msg.data.length >= 3) {
          const signalId = msg.data[0] | (msg.data[1] << 8);
          const serverState = msg.data[2];
          log("Signal ID: " + signalId + ", State: " + serverState);
          signalStateMap.set(signalId, serverState); // 1 = active, 0 = inactive

          // Update UI to reflect state
          updateButtonStates(signalId, serverState);
        }
      }
    } catch (e) {
      log("Non-JSON message or parsing error: " + e.message);
    }
  };

  wsSocket.onclose = function () {
    log("Disconnected");
    updateConnectionStatus(false);
  };

  wsSocket.onerror = function () {
    log("Connection error");
    updateConnectionStatus(false);
  };

  return wsSocket;
}

// Send momentary command
function sendMomentary(channelId, state) {
  if (wsSocket && wsSocket.readyState === WebSocket.OPEN) {
    wsSocket.send(JSON.stringify(DeviceCommands.momentary(channelId, state)));
  }
}

// Send dimmer command
function sendDimmer(channelId, level) {
  if (wsSocket && wsSocket.readyState === WebSocket.OPEN) {
    wsSocket.send(JSON.stringify(DeviceCommands.dimmer(channelId, level)));
  }
}

// Setup button event listeners
function setupButtonListeners() {
  const buttons = document.querySelectorAll(
    ".btn-pill--small, .btn-pill--medium, .btn-pill--long, .btn-round"
  );

  for (let i = 0; i < buttons.length; i++) {
    const button = buttons[i];
    const channelId = parseInt(button.getAttribute("data-channel-id"), 10);

    if (!isNaN(channelId)) {
      // Mousedown event
      button.addEventListener("mousedown", function (event) {
        // Add pressed class based on button type
        if (this.classList.contains("btn-pill--small")) {
          this.classList.add("btn-pill--small--pressed");
        } else if (this.classList.contains("btn-pill--medium")) {
          this.classList.add("btn-pill--medium--pressed");
        } else if (this.classList.contains("btn-pill--long")) {
          this.classList.add("btn-pill--long--pressed");
        } else if (this.classList.contains("btn-round")) {
          this.classList.add("btn-round--pressed");
        }

        sendMomentary(channelId, 1);
      });

      // Mouseup event
      button.addEventListener("mouseup", function (event) {
        // Remove pressed class based on button type
        if (this.classList.contains("btn-pill--small")) {
          this.classList.remove("btn-pill--small--pressed");
        } else if (this.classList.contains("btn-pill--medium")) {
          this.classList.remove("btn-pill--medium--pressed");
        } else if (this.classList.contains("btn-pill--long")) {
          this.classList.remove("btn-pill--long--pressed");
        } else if (this.classList.contains("btn-round")) {
          this.classList.remove("btn-round--pressed");
        }

        sendMomentary(channelId, 0);
      });

      // Touch events for mobile
      button.addEventListener("touchstart", function (event) {
        event.preventDefault(); // Prevent default to avoid double firing with mousedown

        // Add pressed class based on button type
        if (this.classList.contains("btn-pill--small")) {
          this.classList.add("btn-pill--small--pressed");
        } else if (this.classList.contains("btn-pill--medium")) {
          this.classList.add("btn-pill--medium--pressed");
        } else if (this.classList.contains("btn-pill--long")) {
          this.classList.add("btn-pill--long--pressed");
        } else if (this.classList.contains("btn-round")) {
          this.classList.add("btn-round--pressed");
        }

        sendMomentary(channelId, 1);
      });

      button.addEventListener("touchend", function (event) {
        event.preventDefault(); // Prevent default

        // Remove pressed class based on button type
        if (this.classList.contains("btn-pill--small")) {
          this.classList.remove("btn-pill--small--pressed");
        } else if (this.classList.contains("btn-pill--medium")) {
          this.classList.remove("btn-pill--medium--pressed");
        } else if (this.classList.contains("btn-pill--long")) {
          this.classList.remove("btn-pill--long--pressed");
        } else if (this.classList.contains("btn-round")) {
          this.classList.remove("btn-round--pressed");
        }

        sendMomentary(channelId, 0);
      });
    }
  }

  // Setup any dimmer sliders if they exist
  const sliders = document.querySelectorAll(
    'input[type="range"][data-channel-id]'
  );
  for (let i = 0; i < sliders.length; i++) {
    const slider = sliders[i];
    const channelId = parseInt(slider.getAttribute("data-channel-id"), 10);

    if (!isNaN(channelId)) {
      slider.addEventListener("input", function () {
        const value = parseInt(this.value, 10);
        sendDimmer(channelId, value);
      });
    }
  }
  setupPulseButtons();
}

function setupPulseButtons() {
  const pulseButtons = document.querySelectorAll(".pulse-btn");

  for (let i = 0; i < pulseButtons.length; i++) {
    const button = pulseButtons[i];
    const channelId = parseInt(button.getAttribute("data-channel-id"), 10);
    const signalId = parseInt(button.getAttribute("data-signal-id"), 10);

    if (!isNaN(channelId)) {
      // Mousedown event
      button.addEventListener("mousedown", function (event) {
        this.classList.add("active");
        sendMomentary(channelId, 1);
      });

      // Mouseup event
      button.addEventListener("mouseup", function (event) {
        this.classList.remove("active");
        sendMomentary(channelId, 0);
      });

      // Touch events for mobile
      button.addEventListener("touchstart", function (event) {
        event.preventDefault(); // Prevent default to avoid double firing with mousedown
        this.classList.add("active");
        sendMomentary(channelId, 1);
      });

      button.addEventListener("touchend", function (event) {
        event.preventDefault(); // Prevent default
        this.classList.remove("active");
        sendMomentary(channelId, 0);
      });

      // Handle case where mouse/touch leaves button while pressed
      button.addEventListener("mouseleave", function (event) {
        if (this.classList.contains("active")) {
          this.classList.remove("active");
          sendMomentary(channelId, 0);
        }
      });

      button.addEventListener("touchcancel", function (event) {
        this.classList.remove("active");
        sendMomentary(channelId, 0);
      });
    }
  }
}

// Update button states based on signal
function updateButtonStates(signalId, state) {
  const buttons = document.querySelectorAll(
    '[data-signal-id="' + signalId + '"]'
  );

  for (let i = 0; i < buttons.length; i++) {
    const btn = buttons[i];

    // Handle pulse buttons
    if (btn.classList.contains("pulse-btn")) {
      if (state === 1 && !btn.classList.contains("active")) {
        btn.classList.add("active");
      } else if (state === 0 && btn.classList.contains("active")) {
        btn.classList.remove("active");
      }
      continue;
    }

    // Remove all state classes first
    if (btn.classList.contains("btn-pill--small")) {
      btn.classList.remove(
        "btn-pill--small--active",
        "btn-pill--small--inactive"
      );
      btn.classList.add(
        state === 1 ? "btn-pill--small--active" : "btn-pill--small--inactive"
      );
    } else if (btn.classList.contains("btn-pill--medium")) {
      btn.classList.remove(
        "btn-pill--medium--active",
        "btn-pill--medium--inactive"
      );
      btn.classList.add(
        state === 1 ? "btn-pill--medium--active" : "btn-pill--medium--inactive"
      );
    } else if (btn.classList.contains("btn-pill--long")) {
      btn.classList.remove(
        "btn-pill--long--active",
        "btn-pill--long--inactive"
      );
      btn.classList.add(
        state === 1 ? "btn-pill--long--active" : "btn-pill--long--inactive"
      );
    } else if (btn.classList.contains("btn-round")) {
      btn.classList.remove("btn-round--active", "btn-round--inactive");
      btn.classList.add(
        state === 1 ? "btn-round--active" : "btn-round--inactive"
      );
    }
  }
}

// Create connection status indicator
function createStatusIndicator() {
  const statusDiv = document.createElement("div");
  statusDiv.id = "connection-status";
  statusDiv.style.position = "fixed";
  statusDiv.style.top = "10px";
  statusDiv.style.right = "10px";
  statusDiv.style.padding = "5px 10px";
  statusDiv.style.borderRadius = "4px";
  statusDiv.style.fontSize = "12px";
  statusDiv.style.fontWeight = "bold";
  statusDiv.style.color = "white";
  statusDiv.style.backgroundColor = "#171717";
  statusDiv.textContent = "Connecting...";

  document.body.appendChild(statusDiv);
}

// Update connection status indicator
function updateConnectionStatus(connected) {
  const statusDiv = document.getElementById("connection-status");
  if (statusDiv) {
    statusDiv.textContent = connected ? "Connected" : "Disconnected";
    statusDiv.style.backgroundColor = connected ? "#2ecc71" : "#e74c3c";
  }
}

function setupPulseButtonUpdater() {
  // Check pulse button states more frequently (e.g., every 500ms)
  setInterval(function () {
    document.querySelectorAll(".pulse-btn").forEach(function (btn) {
      const signalId = parseInt(btn.dataset.signalId, 10);
      const state = signalStateMap.get(signalId);

      if (debugEnabled) {
        console.log(
          "Pulse button update - SignalID:",
          signalId,
          "State:",
          state,
          "Current class:",
          btn.classList.contains("active") ? "active" : "inactive"
        );
      }

      if (typeof state !== "undefined") {
        btn.classList.toggle("active", state === 1);
      }
    });
  }, 1000);
}
