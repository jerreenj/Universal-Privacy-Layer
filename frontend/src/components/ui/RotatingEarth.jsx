"use client";

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";

export default function RotatingEarth({ width = 600, height = 600, className = "" }) {
  const canvasRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    if (!context) return;

    const containerWidth = Math.min(width, window.innerWidth - 40);
    const containerHeight = Math.min(height, window.innerHeight - 100);
    const radius = Math.min(containerWidth, containerHeight) / 2.2;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = containerWidth * dpr;
    canvas.height = containerHeight * dpr;
    canvas.style.width = `${containerWidth}px`;
    canvas.style.height = `${containerHeight}px`;
    context.scale(dpr, dpr);

    const projection = d3
      .geoOrthographic()
      .scale(radius)
      .translate([containerWidth / 2, containerHeight / 2])
      .clipAngle(90);

    const path = d3.geoPath().projection(projection).context(context);

    const pointInPolygon = (point, polygon) => {
      const [x, y] = point;
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, yi] = polygon[i];
        const [xj, yj] = polygon[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
          inside = !inside;
        }
      }
      return inside;
    };

    const pointInFeature = (point, feature) => {
      const geometry = feature.geometry;
      if (geometry.type === "Polygon") {
        if (!pointInPolygon(point, geometry.coordinates[0])) return false;
        for (let i = 1; i < geometry.coordinates.length; i++) {
          if (pointInPolygon(point, geometry.coordinates[i])) return false;
        }
        return true;
      } else if (geometry.type === "MultiPolygon") {
        for (const polygon of geometry.coordinates) {
          if (pointInPolygon(point, polygon[0])) {
            let inHole = false;
            for (let i = 1; i < polygon.length; i++) {
              if (pointInPolygon(point, polygon[i])) { inHole = true; break; }
            }
            if (!inHole) return true;
          }
        }
      }
      return false;
    };

    const generateDots = (feature, spacing = 18) => {
      const dots = [];
      const bounds = d3.geoBounds(feature);
      const [[minLng, minLat], [maxLng, maxLat]] = bounds;
      const step = spacing * 0.08;
      for (let lng = minLng; lng <= maxLng; lng += step) {
        for (let lat = minLat; lat <= maxLat; lat += step) {
          if (pointInFeature([lng, lat], feature)) dots.push([lng, lat]);
        }
      }
      return dots;
    };

    const allDots = [];
    let landFeatures;

    const render = () => {
      context.clearRect(0, 0, containerWidth, containerHeight);
      const currentScale = projection.scale();
      const scaleFactor = currentScale / radius;

      // Black globe with white border
      context.beginPath();
      context.arc(containerWidth / 2, containerHeight / 2, currentScale, 0, 2 * Math.PI);
      context.fillStyle = "#000000";
      context.fill();
      context.strokeStyle = "#FFFFFF";
      context.lineWidth = 2 * scaleFactor;
      context.stroke();

      if (landFeatures) {
        // White graticule
        const graticule = d3.geoGraticule();
        context.beginPath();
        path(graticule());
        context.strokeStyle = "#FFFFFF";
        context.lineWidth = 0.3 * scaleFactor;
        context.globalAlpha = 0.15;
        context.stroke();
        context.globalAlpha = 1;

        // White land outlines
        context.beginPath();
        landFeatures.features.forEach((f) => path(f));
        context.strokeStyle = "#FFFFFF";
        context.lineWidth = 0.6 * scaleFactor;
        context.globalAlpha = 0.5;
        context.stroke();
        context.globalAlpha = 1;

        // White dots
        allDots.forEach((dot) => {
          const projected = projection([dot.lng, dot.lat]);
          if (projected && projected[0] >= 0 && projected[0] <= containerWidth && projected[1] >= 0 && projected[1] <= containerHeight) {
            context.beginPath();
            context.arc(projected[0], projected[1], 0.8 * scaleFactor, 0, 2 * Math.PI);
            context.fillStyle = "#FFFFFF";
            context.globalAlpha = 0.7;
            context.fill();
            context.globalAlpha = 1;
          }
        });
      }
    };

    const loadData = async () => {
      try {
        const res = await fetch("https://raw.githubusercontent.com/martynafford/natural-earth-geojson/refs/heads/master/110m/physical/ne_110m_land.json");
        if (!res.ok) throw new Error("Failed");
        landFeatures = await res.json();
        landFeatures.features.forEach((f) => {
          generateDots(f, 18).forEach(([lng, lat]) => allDots.push({ lng, lat }));
        });
        render();
      } catch { setError("Failed to load"); }
    };

    const rotation = [0, -15];
    let autoRotate = true;

    const rotate = () => {
      if (autoRotate) {
        rotation[0] += 0.25;
        projection.rotate(rotation);
        render();
      }
    };

    const timer = d3.timer(rotate);

    const onMouseDown = (e) => {
      autoRotate = false;
      const startX = e.clientX, startY = e.clientY;
      const startRot = [...rotation];

      const onMove = (ev) => {
        rotation[0] = startRot[0] + (ev.clientX - startX) * 0.5;
        rotation[1] = Math.max(-90, Math.min(90, startRot[1] - (ev.clientY - startY) * 0.5));
        projection.rotate(rotation);
        render();
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        setTimeout(() => { autoRotate = true; }, 10);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    };

    canvas.addEventListener("mousedown", onMouseDown);
    loadData();

    return () => {
      timer.stop();
      canvas.removeEventListener("mousedown", onMouseDown);
    };
  }, [width, height]);

  if (error) return <div className={className}><p className="text-red-500">{error}</p></div>;

  return <canvas ref={canvasRef} className={`${className}`} style={{ maxWidth: "100%", height: "auto" }} />;
}
