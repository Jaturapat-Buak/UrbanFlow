// server.js
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const path = require("path");
const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// 🗄️ คลังข้อมูลจุดเสี่ยงภัยโครงข่าย กทม.
let cachedFloodRisks = [
  {
    id: "spot-01",
    location_name: "หน้าศาลอาญา ถนนรัชดาภิเษก",
    district: "จตุจักร",
    latitude: 13.8045,
    longitude: 100.5742,
    type: "จุดน้ำท่วมซ้ำซาก",
    pumping_station: "สถานีสูบน้ำคลองทรงกระเทียม",
    drainage_capacity_cms: 6.0,
    canal_connected: "คลองลาดพร้าว",
    cctv_id: "BKK-CAM-102",
  },
  {
    id: "spot-02",
    location_name: "แยกรัชดา-ลาดพร้าว",
    district: "จตุจักร",
    latitude: 13.8062,
    longitude: 100.5748,
    type: "จุดเฝ้าระวังน้ำท่วม",
    pumping_station: "สถานีสูบน้ำคลองน้ำแก้ว",
    drainage_capacity_cms: 4.5,
    canal_connected: "คลองน้ำแก้ว",
    cctv_id: "BKK-CAM-105",
  },
  {
    id: "spot-03",
    location_name: "แยกบางนา ถนนสุขุมวิท",
    district: "บางนา",
    latitude: 13.6682,
    longitude: 100.6058,
    type: "จุดน้ำท่วมซ้ำซาก",
    pumping_station: "สถานีสูบน้ำบางนา",
    drainage_capacity_cms: 12.0,
    canal_connected: "คลองบางนา",
    cctv_id: "BKK-CAM-401",
  },
  {
    id: "spot-04",
    location_name: "นิคมอุตสาหกรรมบางชัน",
    district: "มีนบุรี",
    latitude: 13.8194,
    longitude: 100.7125,
    type: "จุดเฝ้าระวังน้ำท่วม",
    pumping_station: "สถานีสูบน้ำแสนแสบ",
    drainage_capacity_cms: 8.0,
    canal_connected: "คลองแสนแสบ",
    cctv_id: "BKK-CAM-203",
  },
];

// 🧠 API 1: ดึงข้อมูลและจำลองสถานการณ์เชิงรุก
app.get("/api/flood-risks", async (req, res) => {
  try {
    const lats = cachedFloodRisks.map((spot) => spot.latitude).join(",");
    const lons = cachedFloodRisks.map((spot) => spot.longitude).join(",");
    const elevationUrl = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`;

    const elevationRes = await axios
      .get(elevationUrl, { timeout: 3000 })
      .catch(() => ({ data: {} }));
    const elevations = elevationRes.data.elevation || [];

    const finalData = cachedFloodRisks.map((spot, i) => {
      let isRaining = false;
      let mockWaterLevelMeters = 0.0;
      let radarIntensity = "None";
      let accumulatedRain = 0.0;

      // จำลองสถานการณ์:
      // จุดที่ 1 ฝนตกหนักมาก + เป็นจุดแอ่งกระทะท่วมซ้ำซาก (ความเสี่ยงวิกฤต คาดการณ์สีแดงปกติ)
      if (spot.id === "spot-01") {
        isRaining = true;
        radarIntensity = "Heavy";
        mockWaterLevelMeters = 0.05;
        accumulatedRain = 35.5;
      }
      // จุดที่ 2 ฝนตกปานกลาง + จุดเฝ้าระวัง (สีส้ม)
      else if (spot.id === "spot-02") {
        isRaining = true;
        radarIntensity = "Moderate";
        mockWaterLevelMeters = 0.02;
        accumulatedRain = 15.0;
      }
      // จุดที่ 3 แยกบางนา: ตรวจสอบพิกัดเกิดน้ำท่วมขังสูงจริงบนถนน 0.42 เมตร (Level 5 สีแดงเข้ม)
      else if (spot.id === "spot-03") {
        isRaining = false;
        mockWaterLevelMeters = 0.42;
        radarIntensity = "None";
      }

      const currentElevation =
        elevations[i] !== undefined ? elevations[i] : 1.5;
      const isLowLyingBasin = currentElevation <= 1.8;

      return {
        ...spot,
        is_raining: isRaining,
        radar_intensity: radarIntensity,
        accumulated_rain_3h_mm: accumulatedRain,
        sensor_water_level_m: mockWaterLevelMeters,
        canal_level_m: parseFloat((1.2 + Math.random() * 0.4).toFixed(2)),
        cctv_status: "Active",
        elevation: currentElevation,
        is_basin: isLowLyingBasin,
      };
    });

    res.json({ success: true, data: finalData });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// 🔍 API 2: ค้นหาสถานที่ผ่านระบบโครงข่าย
app.get("/api/search", async (req, res) => {
  const query = (req.query.q || "").toLowerCase().trim();
  if (!query) return res.json([]);

  const localFiltered = cachedFloodRisks
    .filter(
      (spot) =>
        spot.location_name.toLowerCase().includes(query) ||
        spot.district.toLowerCase().includes(query),
    )
    .map((spot) => ({
      location_name: `🚨 [พื้นที่เสี่ยง] ${spot.location_name}`,
      district: spot.district,
      latitude: spot.latitude,
      longitude: spot.longitude,
    }));

  try {
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=5&countrycodes=th`;
    const response = await axios.get(nominatimUrl, {
      headers: { "User-Agent": "BKK-Pulse-Alert-Navigator-v5" },
      timeout: 4000,
    });

    const externalResults = response.data.map((item) => {
      const addr = item.address;
      const district =
        addr.suburb ||
        addr.city_district ||
        addr.district ||
        addr.city ||
        addr.state ||
        "ประเทศไทย";
      return {
        location_name: item.display_name.split(",")[0],
        district: district,
        latitude: parseFloat(item.lat),
        longitude: parseFloat(item.lon),
      };
    });

    res.json([...localFiltered, ...externalResults]);
  } catch (err) {
    res.json(localFiltered);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
