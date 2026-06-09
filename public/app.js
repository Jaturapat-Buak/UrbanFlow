// app.js
const map = L.map("map", { zoomControl: false }).setView([13.78, 100.58], 12);
L.control.zoom({ position: "topleft" }).addTo(map);

L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
  attribution: "&copy; OpenStreetMap &copy; CARTO",
}).addTo(map);

// ผูก DOM Elements
const btnRealLocation = document.getElementById("btn-real-location");
const inputStart = document.getElementById("input-start");
const inputEnd = document.getElementById("input-end");
const startSuggestions = document.getElementById("start-suggestions");
const endSuggestions = document.getElementById("end-suggestions");
const btnSearchRoute = document.getElementById("btn-search-route");
const routeDistanceUi = document.getElementById("route-distance-ui");
const apiOutputLog = document.getElementById("api-output-log");
const btnCurrentLocation = document.getElementById("btn-current-location");
const btnTestNear = document.getElementById("btn-test-near");
const btnTestFlood = document.getElementById("btn-test-flood");

let globalSpots = [];
let mapMarkers = [];
let activeRouteLines = [];
let selectedStartCoord = null;
let selectedEndCoord = null;
let userCurrentLocation = null;
let userLocationMarker = null;
let customStartMarker = null;
let customEndMarker = null;

// 🧮 สูตรระยะห่าง
function calculateDistanceInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 🧠 อัลกอริทึมคำนวณคะแนนความเสี่ยงเชิงรุก
function getHazardDetails(spot) {
  let score = 0;
  let reasons = [];

  if (spot.sensor_water_level_m >= 0.35) score += 10;
  else if (spot.sensor_water_level_m >= 0.15) score += 5;

  if (spot.is_raining) {
    score += 4;
    reasons.push("กลุ่มฝนกำลังตก");
  }

  if (spot.is_basin) {
    score += 2;
    reasons.push("พื้นที่ลุ่มต่ำ(แอ่งกระทะ)");
  }

  if (spot.type === "จุดน้ำท่วมซ้ำซาก") {
    score += 2;
    reasons.push("ประวัติน้ำท่วมซ้ำซาก");
  }

  // ระดับเสี่ยงสูงสุด - ท่วมขังจริง (สีแดงเข้ม)
  if (spot.sensor_water_level_m >= 0.35) {
    return {
      level: 5,
      label: "🚨 วิกฤตสูงสุด (ตรวจพบน้ำท่วมขังจริงบนผิวถนน / รถเล็กห้ามผ่าน)",
      color: "#7f1d1d",
      bgClass: "bg-red-950/40",
      borderClass: "border-red-800/80",
      textClass: "text-red-300 font-bold",
      reasons: `เซนเซอร์วัดระดับน้ำท่วมขังได้สูงถึง ${spot.sensor_water_level_m} เมตร สภาพทางผ่านไม่ได้`,
    };
  }
  // เสี่ยงวิกฤต คาดการณ์ล่วงหน้า (สีแดงปกติ)
  else if (score >= 7) {
    return {
      level: 4,
      label: "🔴 วิกฤต (เสี่ยงท่วมฉับพลันสูงมากจากแบบจำลอง / คาดการณ์ล่วงหน้า)",
      color: "#ef4444",
      bgClass: "bg-red-500/10",
      borderClass: "border-red-500/40",
      textClass: "text-red-400",
      reasons: reasons.join(" + "),
    };
  } else if (score >= 4) {
    return {
      level: 3,
      label: "🟠 เฝ้าระวังสูง (มีกลุ่มฝนในพื้นที่เสี่ยง / น้ำเริ่มเอ่อ)",
      color: "#f97316",
      bgClass: "bg-orange-500/10",
      borderClass: "border-orange-500/40",
      textClass: "text-orange-400",
      reasons: reasons.join(" + "),
    };
  } else if (score >= 2) {
    return {
      level: 2,
      label: "🟡 เตือนภัย (มีกลุ่มฝนผ่าน หรือ เป็นพื้นที่ลุ่มต่ำ)",
      color: "#eab308",
      bgClass: "bg-yellow-500/10",
      borderClass: "border-yellow-500/40",
      textClass: "text-yellow-400",
      reasons: reasons.join(" + ") || "มีกลุ่มฝนหรือความเสี่ยงกายภาพ",
    };
  } else {
    // ระดับปกติ - เปลี่ยนสีจากสีเขียวเป็นสีฟ้า/น้ำเงินใส เพื่อใช้สำหรับลากเส้นทางเดินรถที่ไม่โดนผลกระทบภัย
    return {
      level: 1,
      label: "ปกติ (ทางปลอดภัย)",
      color: "#2563eb",
      bgClass: "bg-slate-500/10",
      borderClass: "border-slate-500/40",
      textClass: "text-slate-400",
      reasons: "ไม่มีปัจจัยเสี่ยงคุกคาม",
    };
  }
}

async function fetchFloodRisks() {
  try {
    const res = await fetch("http://localhost:3000/api/flood-risks");
    const json = await res.json();
    if (json.success) {
      globalSpots = json.data;
      renderMarkers(globalSpots);
      checkUserProximityToFlood();
    }
  } catch (err) {
    console.error(err);
  }
}

function renderMarkers(spots) {
  mapMarkers.forEach((m) => map.removeLayer(m));
  mapMarkers = [];

  spots.forEach((spot) => {
    const hazard = getHazardDetails(spot);

    // 🌟 [FEATURE UPDATE] หากพื้นที่ไหนเป็นปกติ (Level 1) จะไม่นำมาวาดลงบนแผนที่โดยเด็ดขาด (ซ่อนออกไปเลย)
    if (hazard.level === 1) {
      return;
    }

    const hazardZone = L.circle([spot.latitude, spot.longitude], {
      radius: 2000,
      color: hazard.color,
      weight: 1.5,
      dashArray: hazard.level === 5 ? "none" : "4, 6",
      fillColor: hazard.color,
      fillOpacity: hazard.level === 5 ? 0.06 : 0.03,
      interactive: false,
    }).addTo(map);
    mapMarkers.push(hazardZone);

    const markerRadius = hazard.level === 5 ? 11 : hazard.level > 2 ? 9 : 7;

    const marker = L.circleMarker([spot.latitude, spot.longitude], {
      radius: markerRadius,
      fillColor: hazard.color,
      color: "#ffffff",
      weight: 1.5,
      fillOpacity: 0.9,
    }).addTo(map);

    const topoText = spot.is_basin
      ? `<span class="text-rose-400 font-medium">⚠️ ลุ่มต่ำ/แอ่งกระทะ</span>`
      : `<span class="text-emerald-400">สูงปกติ</span>`;

    marker.bindPopup(`
      <div class="text-xs text-slate-900 font-sans w-64">
        <div class="border-b pb-1 mb-1 font-bold text-slate-800 flex flex-col gap-0.5">
          <span class="text-sm">📍 ${spot.location_name}</span>
          <span class="text-[10px] px-1.5 py-0.5 rounded text-white font-medium inline-block w-fit" style="background-color: ${hazard.color}">${hazard.label}</span>
        </div>
        <div class="bg-slate-100 p-1.5 rounded mb-1 border border-slate-200">
          <p class="text-[10px] text-slate-700 font-medium">🔍 <b>สาเหตุวิเคราะห์:</b> ${hazard.reasons}</p>
        </div>
        <p class="mt-1 text-[11px]">⛈️ <b>เรดาร์ฝน:</b> ${spot.is_raining ? `พบกลุ่มฝน (${spot.radar_intensity})` : "ไม่มีกลุ่มฝน"}</p>
        <p class="mt-1 text-[11px]">🌊 <b>เซนเซอร์ระดับน้ำบนถนน:</b> <span class="font-bold ${spot.sensor_water_level_m >= 0.35 ? "text-red-700 text-sm" : spot.sensor_water_level_m > 0.15 ? "text-red-600" : "text-slate-800"}">${spot.sensor_water_level_m} เมตร</span></p>
        <p class="mt-1 text-[11px]">⛰️ <b>ลักษณะทางกายภาพ:</b> ความสูง ${spot.elevation} ม. (${topoText})</p>
      </div>
    `);
    mapMarkers.push(marker);
  });
}

function checkUserProximityToFlood() {
  const alertBox = document.getElementById("proximity-alert-box");
  if (!alertBox) return;
  if (window.userRadarCircle) map.removeLayer(window.userRadarCircle);

  if (!userCurrentLocation || globalSpots.length === 0) {
    alertBox.classList.add("hidden");
    return;
  }

  window.userRadarCircle = L.circle(userCurrentLocation, {
    radius: 2000,
    color: "#3b82f6",
    weight: 1.5,
    dashArray: "6, 6",
    fillColor: "#3b82f6",
    fillOpacity: 0.02,
    interactive: false,
  }).addTo(map);

  const activeThreats = [];
  globalSpots.forEach((spot) => {
    const hazard = getHazardDetails(spot);
    // ตรวจเฉพาะจุดที่เป็นปัญหาจริง (Level 2 ขึ้นไป) ไม่นับ Level 1
    if (hazard.level > 1) {
      const distance = calculateDistanceInMeters(
        userCurrentLocation[0],
        userCurrentLocation[1],
        spot.latitude,
        spot.longitude,
      );
      if (distance <= 2000)
        activeThreats.push({
          spot,
          hazard,
          distanceKm: (distance / 1000).toFixed(2),
        });
    }
  });

  if (activeThreats.length > 0) {
    activeThreats.sort((a, b) => b.hazard.level - a.hazard.level);
    alertBox.classList.remove("hidden");
    let htmlResult = `
      <div class="bg-slate-900/80 border border-slate-700 p-3 rounded-lg text-xs space-y-2">
        <div class="flex items-center gap-2 text-white font-bold">
          <span class="inline-block w-2 h-2 rounded-full bg-blue-500 animate-ping"></span>
          📡 เรดาร์สแกนพบจุดเฝ้าระวังใกล้ตัว
        </div>
        <div class="space-y-2 max-h-36 overflow-y-auto pr-1">
    `;
    activeThreats.forEach((item) => {
      htmlResult += `
        <div class="p-2 rounded border ${item.hazard.bgClass} ${item.hazard.borderClass}">
          <div class="flex justify-between font-medium ${item.hazard.textClass}">
            <span>• ${item.spot.location_name}</span><span>ห่าง ${item.distanceKm} กม.</span>
          </div>
          <p class="text-[10px] text-slate-400 mt-0.5">${item.hazard.label}</p>
        </div>`;
    });
    htmlResult += `</div></div>`;
    alertBox.innerHTML = htmlResult;
  } else {
    // 🌟 [FEATURE UPDATE] นำกล่องสถานะสีเขียวออกไป หากปลอดภัยจะซ่อน Component ไปเลยเพื่อความคลีน
    alertBox.innerHTML = "";
    alertBox.classList.add("hidden");
  }
}

function updateUserLocationOnMap(lat, lon, labelText = "ตำแหน่งของคุณ") {
  userCurrentLocation = [lat, lon];
  if (btnCurrentLocation) btnCurrentLocation.classList.remove("hidden");
  if (userLocationMarker) map.removeLayer(userLocationMarker);
  userLocationMarker = L.circleMarker([lat, lon], {
    radius: 8,
    fillColor: "#3b82f6",
    color: "#ffffff",
    weight: 2,
    fillOpacity: 1,
  }).addTo(map);
  userLocationMarker.bindPopup(
    `<div class="text-xs text-slate-900 font-bold">📍 ${labelText}</div>`,
  );
  map.setView([lat, lon], 13);
  checkUserProximityToFlood();
}

if (btnTestNear)
  btnTestNear.addEventListener("click", () =>
    updateUserLocationOnMap(13.8125, 100.567, "จำลอง: ใกล้เขตรัชดา-ศาลอาญา"),
  );
if (btnTestFlood)
  btnTestFlood.addEventListener("click", () =>
    updateUserLocationOnMap(
      13.6682,
      100.6058,
      "จำลอง: พิกัดใกล้จุดน้ำท่วมจริง (แยกบางนา)",
    ),
  );

function setupAutocomplete(inputElem, suggestionBoxElem, isStart) {
  let debounceTimer;
  inputElem.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    const query = inputElem.value.trim();
    if (isStart) selectedStartCoord = null;
    else selectedEndCoord = null;

    if (query.length < 2) {
      suggestionBoxElem.classList.add("hidden");
      return;
    }

    debounceTimer = setTimeout(async () => {
      try {
        const res = await fetch(
          `http://localhost:3000/api/search?q=${encodeURIComponent(query)}`,
        );
        const results = await res.json();

        if (results.length === 0) {
          suggestionBoxElem.classList.add("hidden");
          return;
        }
        suggestionBoxElem.innerHTML = "";
        suggestionBoxElem.classList.remove("hidden");

        results.forEach((item) => {
          const row = document.createElement("div");
          row.className =
            "p-2 hover:bg-slate-800 text-xs text-slate-200 cursor-pointer border-b border-slate-800 transition";
          row.innerHTML = `<div class="font-medium text-white">${item.location_name}</div><div class="text-[10px] text-slate-400">${item.district}</div>`;
          row.addEventListener("click", () => {
            inputElem.value = item.location_name.replace(/🚨 \[.*?\] /g, "");

            const coords = {
              lat: parseFloat(item.latitude),
              lng: parseFloat(item.longitude),
            };

            if (isStart) {
              selectedStartCoord = coords;
              if (customStartMarker) map.removeLayer(customStartMarker);
              customStartMarker = L.marker([coords.lat, coords.lng])
                .addTo(map)
                .bindPopup(`🟢 ต้นทาง: ${inputElem.value}`)
                .openPopup();
            } else {
              selectedEndCoord = coords;
              if (customEndMarker) map.removeLayer(customEndMarker);
              customEndMarker = L.marker([coords.lat, coords.lng])
                .addTo(map)
                .bindPopup(`🏁 ปลายทาง: ${inputElem.value}`)
                .openPopup();
            }
            suggestionBoxElem.classList.add("hidden");
          });
          suggestionBoxElem.appendChild(row);
        });
      } catch (err) {
        console.error(err);
      }
    }, 400);
  });
}

setupAutocomplete(inputStart, startSuggestions, true);
setupAutocomplete(inputEnd, endSuggestions, false);

if (btnCurrentLocation) {
  btnCurrentLocation.addEventListener("click", () => {
    if (userCurrentLocation) {
      selectedStartCoord = {
        lat: userCurrentLocation[0],
        lng: userCurrentLocation[1],
      };
      inputStart.value = "ตำแหน่งปัจจุบันของคุณ";
      if (customStartMarker) map.removeLayer(customStartMarker);
      customStartMarker = L.marker(userCurrentLocation)
        .addTo(map)
        .bindPopup("🟢 ต้นทาง: ตำแหน่งปัจจุบันของคุณ")
        .openPopup();
    }
  });
}

if (btnSearchRoute) {
  btnSearchRoute.addEventListener("click", async () => {
    if (!selectedStartCoord || !selectedEndCoord) {
      alert(
        "กรุณาเลือกจุดเริ่มต้นและจุดหมายปลายทางจากรายการที่แนะนำให้เรียบร้อยครับ",
      );
      return;
    }

    try {
      activeRouteLines.forEach((l) => map.removeLayer(l));
      activeRouteLines = [];
      apiOutputLog.innerHTML = `<p class="text-xs text-slate-400 animate-pulse">กำลังคำนวณเส้นทางผ่านเซิร์ฟเวอร์ OSRM...</p>`;

      const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${selectedStartCoord.lng},${selectedStartCoord.lat};${selectedEndCoord.lng},${selectedEndCoord.lat}?overview=full&geometries=geojson`;
      const res = await fetch(osrmUrl);
      const data = await res.json();

      if (data.code !== "Ok" || !data.routes || data.routes.length === 0) {
        apiOutputLog.innerHTML = `<p class="text-xs text-rose-400">❌ ไม่พบโครงข่ายเชื่อมต่อถนนระหว่างสถานที่คู่นี้</p>`;
        return;
      }

      const routeData = data.routes[0];
      const distanceKm = (routeData.distance / 1000).toFixed(2);
      const durationMin = Math.ceil(routeData.duration / 60);
      routeDistanceUi.innerText = `ระยะทาง ${distanceKm} กม. (~${durationMin} นาที)`;

      const routeCoords = routeData.geometry.coordinates.map((c) => [
        c[1],
        c[0],
      ]);

      let maxLevelEncountered = 1;
      let worstThreatSpot = null;

      for (let p of routeCoords) {
        for (let spot of globalSpots) {
          const hazard = getHazardDetails(spot);
          if (hazard.level > 1) {
            const distance = calculateDistanceInMeters(
              p[0],
              p[1],
              spot.latitude,
              spot.longitude,
            );
            if (distance <= 400) {
              if (hazard.level > maxLevelEncountered) {
                maxLevelEncountered = hazard.level;
                worstThreatSpot = spot;
              }
            }
          }
        }
      }

      const finalHazard = worstThreatSpot
        ? getHazardDetails(worstThreatSpot)
        : { level: 1, color: "#3b82f6" };

      // ลากเส้นโพลีไลน์แสดงทางเดินรถ (หากปลอดภัยไม่มีจุดเสี่ยงตัดผ่าน จะถูกวาดเป็นเส้นสีน้ำเงินสว่าง #3b82f6 แทนสีเขียว)
      const mainPolyline = L.polyline(routeCoords, {
        color: finalHazard.color,
        weight: 6,
        opacity: 0.8,
      }).addTo(map);
      activeRouteLines.push(mainPolyline);
      map.fitBounds(mainPolyline.getBounds().pad(0.1));

      if (maxLevelEncountered === 5) {
        apiOutputLog.innerHTML = `
          <div class="space-y-1.5 p-2.5 rounded border border-red-900 bg-red-950/40 text-left">
            <p class="text-red-400 font-bold flex items-center gap-1 text-xs">🛑 ห้ามผ่าน! พบน้ำท่วมขังวิกฤตบนผิวทาง</p>
            <p class="text-slate-300 text-[11px] font-light">เส้นทางพาดผ่านบริเวณ <b>${worstThreatSpot.location_name}</b> ซึ่งขณะนี้ตรวจพบ <span class="text-red-400 font-bold font-mono">น้ำท่วมสูงแล้ว ${worstThreatSpot.sensor_water_level_m} ม.</span> รถยนต์เล็กไม่สามารถผ่านได้</p>
            <p class="text-rose-400 text-[11px] pt-1 font-medium">❌ คำเตือน: โปรดกลับรถหรือเลือกอ้อมจุดนี้เพื่อป้องกันความเสียหายต่อตัวรถ</p>
          </div>`;
      } else if (maxLevelEncountered === 4) {
        apiOutputLog.innerHTML = `
          <div class="space-y-1.5 p-2.5 rounded border border-red-500/30 bg-red-500/5">
            <p class="text-red-400 font-bold flex items-center gap-1 text-xs">🚨 เส้นทางตัดผ่านเขตเสี่ยงวิกฤต!</p>
            <p class="text-slate-300 text-[11px] font-light">เส้นทางพาดผ่าน <b>${worstThreatSpot.location_name}</b> ซึ่งระบบคาดการณ์วิกฤตเนื่องจาก: <span class="text-red-400">${finalHazard.reasons}</span></p>
            <p class="text-amber-400 text-[11px] pt-1">💡 เลี่ยงเส้นทางชั่วคราว พื้นที่นี้สะสมน้ำไวและระบายยาก</p>
          </div>`;
      } else if (maxLevelEncountered === 3) {
        apiOutputLog.innerHTML = `
          <div class="space-y-1.5 p-2.5 rounded border border-orange-500/30 bg-orange-500/5">
            <p class="text-orange-400 font-bold flex items-center gap-1 text-xs">⚠️ สภาวะเฝ้าระวังสูง</p>
            <p class="text-slate-300 text-[11px] font-light">ผ่านจุดเสี่ยง <b>${worstThreatSpot.location_name}</b> ปัจจัย: ${finalHazard.reasons}</p>
          </div>`;
      } else if (maxLevelEncountered === 2) {
        apiOutputLog.innerHTML = `
          <div class="space-y-1.5 p-2.5 rounded border border-yellow-500/30 bg-yellow-500/5">
            <p class="text-yellow-400 font-bold flex items-center gap-1 text-xs">🌧️ เส้นทางมีกลุ่มฝนผ่าน</p>
            <p class="text-slate-300 text-[11px] font-light">บริเวณ <b>${worstThreatSpot.location_name}</b> ถนนอาจลื่นและทัศนวิสัยต่ำ</p>
          </div>`;
      } else {
        // 🌟 [FEATURE UPDATE] เปลี่ยนการรายงานทิศทางเมื่อปลอดภัย ให้เป็นธีมบลูสกาย/น้ำเงินเข้มขรึมแทนสีเขียว
        apiOutputLog.innerHTML = `
          <div class="space-y-1 p-2 bg-blue-500/5 border border-blue-500/20 rounded">
            <p class="text-blue-400 font-bold text-xs">🔷 เส้นทางปกติ (Clear Route)</p>
            <p class="text-slate-300 text-[11px] font-light">• ปลอดภัยจากปัญหาภัยน้ำท่วมขัง สามารถขับขี่สัญจรได้ตามรอบปกติ</p>
          </div>`;
      }
    } catch (err) {
      console.error("Routing error:", err);
      apiOutputLog.innerHTML = `<p class="text-xs text-red-400">❌ เกิดข้อผิดพลาดในการดึงเส้นทาง OSRM</p>`;
    }
  });
}

fetchFloodRisks();
setInterval(fetchFloodRisks, 30000);

function fetchRealLocation(isManualClick = false) {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        updateUserLocationOnMap(lat, lon, "ตำแหน่งจริงของคุณ");
      },
      (error) => {
        console.warn("ไม่สามารถดึงตำแหน่งได้:", error.message);
        if (isManualClick) {
          alert(
            "ไม่สามารถดึงตำแหน่งได้ กรุณาตรวจสอบสิทธิ์การเข้าถึง Location ในเบราว์เซอร์",
          );
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  } else if (isManualClick) {
    alert("เบราว์เซอร์ของคุณไม่รองรับการดึงตำแหน่ง");
  }
}

if (btnRealLocation) {
  btnRealLocation.addEventListener("click", () => {
    fetchRealLocation(true);
  });
}

window.addEventListener("load", () => {
  fetchRealLocation(false);
});
