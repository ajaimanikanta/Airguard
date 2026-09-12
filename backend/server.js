require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const twilio = require("twilio");

const app = express();

app.use(cors());
app.use(express.json());

// ==========================================
// MYSQL CONNECTION
// ==========================================

const db = mysql.createPool({
    host: "localhost",
    user: "root",
    password: "Sql@9999",
    database: "airguard",
    port: 3306,

    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// ==========================================
// TWILIO CONFIGURATION
// ==========================================

const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

// ==========================================
// STATUS TRACKING
// ==========================================

let previousStatus = "NORMAL";

// ==========================================
// GET STATUS FROM SMOKE VALUE
// ==========================================

function getStatus(smoke) {

    if (smoke < 300) {
        return "NORMAL";
    }

    if (smoke < 350) {
        return "WARNING";
    }

    return "CRITICAL";
}

// ==========================================
// ALERT MESSAGE
// ==========================================

function getAlertMessage(status) {

    if (status === "WARNING") {
        return "Elevated smoke or gas level detected.";
    }

    if (status === "CRITICAL") {
        return "Critical smoke level detected. Immediate attention required.";
    }

    return "Air quality is normal.";
}

// ==========================================
// SEND CRITICAL SMS
// ==========================================

async function sendCriticalSMS() {
    try {
        console.log("📡 Connecting to Twilio...");

        const result = await twilioClient.messages.create({
            body: "sms_account_alerts",
            from: process.env.TWILIO_FROM_NUMBER,
            to: process.env.ALERT_PHONE_NUMBER
        });

        console.log("📱 Critical SMS sent successfully");
        console.log("SMS SID:", result.sid);

    } catch (error) {
        console.error("❌ SMS failed:");
        console.error("Code:", error.code);
        console.error("Message:", error.message);
    }
}

// ==========================================
// HOME
// ==========================================

app.get("/", (req, res) => {

    res.send(`
        <h1>AirGuard Backend</h1>
        <p>Server is running.</p>
    `);
});

// ==========================================
// GET LATEST READING
// ==========================================

app.get("/api/readings", async (req, res) => {

    try {

        const [rows] = await db.query(`
            SELECT
                id,
                smoke,
                temperature,
                humidity,
                status,
                timestamp
            FROM sensor_readings
            ORDER BY timestamp DESC
            LIMIT 1
        `);

        if (rows.length === 0) {

            return res.status(404).json({
                message: "No sensor readings available"
            });
        }

        res.json(rows[0]);

    } catch (error) {

        console.error(
            "Reading error:",
            error
        );

        res.status(500).json({
            error: "Database error"
        });
    }
});

// ==========================================
// GET HISTORY
// ==========================================

app.get("/api/history", async (req, res) => {

    try {

        const range =
            String(req.query.range || "LIVE").toUpperCase();

        let minutes;

        if (range === "LIVE") {
            minutes = 30;
        }

        else if (range === "1H") {
            minutes = 60;
        }

        else if (range === "6H") {
            minutes = 360;
        }

        else if (range === "24H") {
            minutes = 1440;
        }

        else {

            return res.status(400).json({
                error: "Invalid range"
            });
        }

        const [rows] = await db.query(
            `
            SELECT
                id,
                smoke,
                temperature,
                humidity,
                status,
                timestamp
            FROM sensor_readings
            WHERE timestamp >= DATE_SUB(NOW(), INTERVAL ? MINUTE)
            ORDER BY timestamp ASC
            `,
            [minutes]
        );

        res.json(rows);

    } catch (error) {

        console.error(
            "History error:",
            error
        );

        res.status(500).json({
            error: "Database error"
        });
    }
});

// ==========================================
// POST SENSOR READING
// ==========================================

app.post("/api/readings", async (req, res) => {

    try {

        const {
            smoke,
            temperature,
            humidity
        } = req.body;

        // ------------------------------
        // VALIDATION
        // ------------------------------

        if (
            smoke === undefined ||
            temperature === undefined ||
            humidity === undefined
        ) {

            return res.status(400).json({
                error:
                    "smoke, temperature and humidity are required"
            });
        }

        const smokeValue =
            Number(smoke);

        const temperatureValue =
            Number(temperature);

        const humidityValue =
            Number(humidity);

        if (
            !Number.isFinite(smokeValue) ||
            !Number.isFinite(temperatureValue) ||
            !Number.isFinite(humidityValue)
        ) {

            return res.status(400).json({
                error: "Sensor values must be numeric"
            });
        }

        // ------------------------------
        // DETERMINE STATUS
        // ------------------------------

        const status =
            getStatus(smokeValue);

        const alertMessage =
            getAlertMessage(status);

        console.log(
            `Reading → Smoke: ${smokeValue}, Temp: ${temperatureValue}, Humidity: ${humidityValue}, Status: ${status}`
        );

        // ------------------------------
        // SAVE SENSOR READING
        // ------------------------------

        await db.query(
            `
            INSERT INTO sensor_readings
            (
                smoke,
                temperature,
                humidity,
                status
            )
            VALUES (?, ?, ?, ?)
            `,
            [
                smokeValue,
                temperatureValue,
                humidityValue,
                status
            ]
        );

        // ------------------------------
        // ALERT LOGIC
        // ------------------------------

        const statusChanged =
            status !== previousStatus;

        // WARNING / CRITICAL alert
        // only when status changes

        if (
            statusChanged &&
            (
                status === "WARNING" ||
                status === "CRITICAL"
            )
        ) {

            // Save alert to database

            await db.query(
                `
                INSERT INTO alert_history
                (
                    smoke,
                    temperature,
                    humidity,
                    status,
                    message
                )
                VALUES (?, ?, ?, ?, ?)
                `,
                [
                    smokeValue,
                    temperatureValue,
                    humidityValue,
                    status,
                    alertMessage
                ]
            );

            console.log(
                `🚨 ${status} alert recorded`
            );
        }

        // ------------------------------
        // SEND SMS ONLY WHEN ENTERING
        // CRITICAL STATUS
        // ------------------------------

        if (
            status === "CRITICAL" &&
            previousStatus !== "CRITICAL"
        ) {

            console.log("🚨 CRITICAL detected - sending SMS...");

await sendCriticalSMS();
        }

        // ------------------------------
        // UPDATE PREVIOUS STATUS
        // ------------------------------

        previousStatus = status;

        // ------------------------------
        // RESPONSE TO ESP32
        // ------------------------------

        res.status(200).json({
            success: true,
            smoke: smokeValue,
            temperature: temperatureValue,
            humidity: humidityValue,
            status: status
        });

    } catch (error) {

        console.error(
            "POST reading error:",
            error
        );

        res.status(500).json({
            error: "Failed to save sensor reading"
        });
    }
});

// ==========================================
// GET ALERT HISTORY
// ==========================================

app.get("/api/alerts", async (req, res) => {

    try {

        const [rows] = await db.query(`
            SELECT
                id,
                smoke,
                temperature,
                humidity,
                status,
                message,
                timestamp
            FROM alert_history
            ORDER BY timestamp DESC
            LIMIT 20
        `);

        res.json(rows);

    } catch (error) {

        console.error(
            "Alerts error:",
            error
        );

        res.status(500).json({
            error: "Database error"
        });
    }
});

// ==========================================
// START SERVER
// ==========================================

const PORT = 3000;

app.listen(PORT, "0.0.0.0", () => {

    console.log("----------------------------------");
    console.log("       AIRGUARD BACKEND");
    console.log("----------------------------------");
    console.log(
        `Server running on port ${PORT}`
    );
    console.log(
        "Local API: http://localhost:3000/api/readings"
    );
    console.log(
        "History API: http://localhost:3000/api/history"
    );
    console.log(
        "Alert API: http://localhost:3000/api/alerts"
    );
    console.log("----------------------------------");
});