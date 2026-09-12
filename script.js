const API_URL = "http://localhost:3000/api/readings";
const HISTORY_URL = "http://localhost:3000/api/history";
const ALERTS_URL = "http://localhost:3000/api/alerts";

let currentRange = "LIVE";
let smokeChart = null;

// ===============================
// FORMAT TIME
// ===============================
function formatTime(timestamp) {
    if (!timestamp) return "--";

    const date = new Date(timestamp);

    return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    });
}

// ===============================
// UPDATE SYSTEM STATUS
// ===============================
function updateStatus(status) {
    const statusElement = document.getElementById("status");
    const messageElement = document.getElementById("statusMessage");
    const iconElement = document.getElementById("statusIcon");

    if (!statusElement) return;

    statusElement.textContent = status || "OFFLINE";

    if (status === "NORMAL") {
        if (messageElement)
            messageElement.textContent =
                "Air quality is within the normal range.";

        if (iconElement)
            iconElement.textContent = "✓";

    } else if (status === "WARNING") {
        if (messageElement)
            messageElement.textContent =
                "Elevated smoke or gas level detected.";

        if (iconElement)
            iconElement.textContent = "⚠";

    } else if (status === "CRITICAL") {
        if (messageElement)
            messageElement.textContent =
                "Critical smoke level detected. Immediate attention required.";

        if (iconElement)
            iconElement.textContent = "🚨";

    } else {
        if (messageElement)
            messageElement.textContent =
                "Unable to communicate with AirGuard.";

        if (iconElement)
            iconElement.textContent = "!";
    }

    statusElement.classList.remove(
        "normal",
        "warning",
        "critical",
        "offline"
    );

    if (status === "NORMAL") {
        statusElement.classList.add("normal");
    } else if (status === "WARNING") {
        statusElement.classList.add("warning");
    } else if (status === "CRITICAL") {
        statusElement.classList.add("critical");
    } else {
        statusElement.classList.add("offline");
    }
}

// ===============================
// LOAD ALERTS
// ===============================
async function loadAlerts() {
    try {
        const response = await fetch(ALERTS_URL);

        if (!response.ok) {
            throw new Error("Failed to load alerts");
        }

        const alerts = await response.json();

        const container = document.getElementById("alertContainer");
        const countElement = document.getElementById("alert-count");

        if (!container) return;

        if (!alerts || alerts.length === 0) {
            if (countElement) {
                countElement.textContent = "0 ACTIVE";
            }

            container.innerHTML = `
                <div class="normal-alert">
                    <div class="alert-icon">✓</div>
                    <div class="alert-content">
                        <strong>NO ACTIVE ALERTS</strong>
                        <p>AirGuard is monitoring normally.</p>
                    </div>
                </div>
            `;

            return;
        }

        // Show number of stored alerts
        if (countElement) {
            countElement.textContent =
                `${alerts.length} ACTIVE`;
        }

        container.innerHTML = alerts.map(alert => {

            const isCritical =
                alert.status === "CRITICAL";

            return `
                <div class="${isCritical ? "critical-alert" : "warning-alert"}">

                    <div class="alert-icon">
                        ${isCritical ? "🚨" : "⚠"}
                    </div>

                    <div class="alert-content">

                        <strong>
                            ${alert.status}
                        </strong>

                        <p>
                            ${alert.message}
                        </p>

                        <small>
                            Smoke: ${alert.smoke}
                            &nbsp; | &nbsp;
                            Temperature: ${alert.temperature}°C
                            &nbsp; | &nbsp;
                            Humidity: ${alert.humidity}%
                            &nbsp; | &nbsp;
                            ${formatTime(alert.timestamp)}
                        </small>

                    </div>

                </div>
            `;
        }).join("");

    } catch (error) {
        console.error("Alert loading error:", error);
    }
}

// ===============================
// CREATE GRAPH
// ===============================
function createChart(history) {

    const canvas = document.getElementById("smokeChart");

    if (!canvas) return;

    const ctx = canvas.getContext("2d");

    if (smokeChart) {
        smokeChart.destroy();
    }

    const labels = history.map(item =>
        formatTime(item.timestamp)
    );

    const smokeValues = history.map(item =>
        Number(item.smoke)
    );

    smokeChart = new Chart(ctx, {
        type: "line",

        data: {
            labels: labels,

            datasets: [{
                label: "Smoke Level",
                data: smokeValues,

                tension: 0.35,

                fill: true,

                pointRadius: 2,

                pointHoverRadius: 5
            }]
        },

        options: {
            responsive: true,

            maintainAspectRatio: false,

            interaction: {
                intersect: false,
                mode: "index"
            },

            scales: {

                x: {
                    ticks: {
                        maxTicksLimit: 8
                    }
                },

                y: {
                    beginAtZero: true,

                    title: {
                        display: true,
                        text: "Smoke Sensor Value"
                    }
                }
            },

            plugins: {
                legend: {
                    display: true
                }
            }
        }
    });
}

// ===============================
// LOAD HISTORY
// ===============================
async function loadHistory(range = currentRange) {

    try {

        const response =
            await fetch(`${HISTORY_URL}?range=${range}`);

        if (!response.ok) {
            throw new Error("Failed to load history");
        }

        const history = await response.json();

        createChart(history);

    } catch (error) {

        console.error(
            "History loading error:",
            error
        );
    }
}

// ===============================
// GRAPH CONTROLS
// ===============================
function setupGraphControls() {

    const buttons =
        document.querySelectorAll("[data-range]");

    buttons.forEach(button => {

        button.addEventListener("click", async () => {

            const range =
                button.dataset.range;

            currentRange =
                range.toUpperCase();

            buttons.forEach(btn =>
                btn.classList.remove("active")
            );

            button.classList.add("active");

            await loadHistory(currentRange);
        });

    });
}

// ===============================
// UPDATE CURRENT READING
// ===============================
async function updateCurrentReading() {

    try {

        const response =
            await fetch(API_URL);

        if (!response.ok) {
            throw new Error("Backend unavailable");
        }

        const data =
            await response.json();

        console.log(
            "Current AirGuard reading:",
            data
        );

        // Smoke
        const smokeElement =
            document.getElementById("smoke");

        if (smokeElement) {
            smokeElement.textContent =
                data.smoke;
        }

        // Smoke meter
        const smokeMeter =
            document.getElementById("smokeMeter");

        if (smokeMeter) {

            let percentage =
                Math.min(
                    (Number(data.smoke) / 500) * 100,
                    100
                );

            smokeMeter.style.width =
                `${percentage}%`;
        }

        // Smoke status value
        const smokeStatusValue =
            document.getElementById(
                "smokeStatusValue"
            );

        if (smokeStatusValue) {
            smokeStatusValue.textContent =
                data.smoke;
        }

        // Temperature
        const temperatureElement =
            document.getElementById("temperature");

        if (temperatureElement) {
            temperatureElement.textContent =
                `${Number(data.temperature).toFixed(1)}°C`;
        }

        // Humidity
        const humidityElement =
            document.getElementById("humidity");

        if (humidityElement) {
            humidityElement.textContent =
                `${Number(data.humidity).toFixed(1)}%`;
        }

        // Status
        updateStatus(data.status);

        // Last updated
        const updatedElement =
            document.getElementById("updatedTime");

        if (updatedElement) {
            updatedElement.textContent =
                `Updated ${formatTime(data.timestamp)}`;
        }

    } catch (error) {

        console.error(
            "Current reading error:",
            error
        );

        updateStatus("OFFLINE");
    }
}

// ===============================
// INITIALIZE DASHBOARD
// ===============================
async function initializeDashboard() {

    await updateCurrentReading();

    await loadAlerts();

    await loadHistory(currentRange);

    setupGraphControls();
}

// ===============================
// AUTOMATIC REFRESH
// ===============================

// Current ESP32 reading
setInterval(
    updateCurrentReading,
    3000
);

// Alerts
setInterval(
    loadAlerts,
    5000
);

// Graph
setInterval(
    () => loadHistory(currentRange),
    15000
);

// Start dashboard
document.addEventListener(
    "DOMContentLoaded",
    initializeDashboard
);