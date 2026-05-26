export function trackCardPoseFromFrame(previousPose, cardTarget, frame = null) {
  if (!previousPose?.location || !frame?.imageData?.data) return null;
  const base = geometryFromLocation(previousPose.location, cardTarget);
  if (!base) return null;
  const markerRatio = cardTarget?.cornerMarkerRatio || { x: 0.84, y: 0.855 };
  const markerRadius = Math.max(5, base.halfW * 0.075);
  const searchRadius = Math.max(12, markerRadius * 2.65);
  const markers = base.markerCenters.map((center, index) => {
    const hit = locateDarkMarker(frame, center, searchRadius);
    return hit ? { ...hit, index } : null;
  });
  const refined = refinePoseFromMarkers(base, markers, markerRatio, frame, cardTarget, "image-marker");
  if (!refined) return null;
  const textConfidence = sampleTextSignature(refined, cardTarget, frame);
  const dataConfidence = sampleDataSignature(refined, cardTarget, frame);
  if (!isRecognizedSynthCard(refined, textConfidence, dataConfidence, cardTarget)) return null;
  return {
    ...refined,
    textConfidence,
    dataConfidence,
    decodedPayload: cardTarget?.encodedPayload || ""
  };
}

export function detectCardPoseFromFrame(cardTarget, frame = null) {
  if (!frame?.imageData?.data || !frame.width || !frame.height) return null;
  const textPanelPose = detectHiroTextMarkerPose(cardTarget, frame);
  if (textPanelPose) return textPanelPose;
  if (cardTarget?.hiroMarker?.requireTextPanelOnly) return null;

  const candidates = findDarkSquareCandidates(frame);
  if (candidates.length < 4) return null;

  const corners = chooseBestCardCorners(candidates, cardTarget, frame) || chooseExtremeCorners(candidates);
  if (!corners) return null;

  const markerRatio = cardTarget?.cornerMarkerRatio || { x: 0.84, y: 0.855 };
  const base = geometryFromMarkerCenters(corners, markerRatio, cardTarget);
  if (!base) return null;
  const refined = refinePoseFromMarkers(base, corners, markerRatio, frame, cardTarget, "text-card");
  const textConfidence = sampleTextSignature(refined, cardTarget, frame);
  const dataConfidence = sampleDataSignature(refined, cardTarget, frame);
  if (!isRecognizedSynthCard(refined, textConfidence, dataConfidence, cardTarget)) return null;
  return {
    ...refined,
    textConfidence,
    dataConfidence,
    decodedPayload: cardTarget?.encodedPayload || ""
  };
}

function detectHiroTextMarkerPose(cardTarget, frame) {
  const panel = cardTarget?.textPanel;
  if (!cardTarget?.hiroMarker?.enabled || !panel?.w || !panel?.h) return null;
  const candidates = findBrightPanelCandidates(frame);
  let best = null;
  for (const candidate of candidates) {
    const panelAspect = panel.w / panel.h;
    const aspect = candidate.width / Math.max(candidate.height, 1);
    if (aspect < panelAspect * 0.58 || aspect > panelAspect * 1.62) continue;
    const whiteRatio = candidate.fill;
    const surroundDarkRatio = sampleRectRingDarkRatio(frame, candidate.bounds, 0.32);
    const textDarkRatio = sampleRectDarkRatio(frame, insetBounds(candidate.bounds, 0.08), 104);
    if (whiteRatio < (panel.minWhiteRatio ?? 0.46)) continue;
    if (surroundDarkRatio < (panel.minDarkSurroundRatio ?? 0.28)) continue;
    if (textDarkRatio < (panel.minTextDarkRatio ?? 0.075)) continue;

    const halfW = candidate.width / (panel.w * 2);
    const halfH = candidate.height / (panel.h * 2);
    const panelCenterOffsetX = (panel.x + panel.w * 0.5 - 0.5) * halfW * 2;
    const panelCenterOffsetY = (panel.y + panel.h * 0.5 - 0.5) * halfH * 2;
    const cardCenter = point(candidate.x - panelCenterOffsetX, candidate.y - panelCenterOffsetY);
    const base = makeGeometry(cardCenter, point(1, 0), point(0, 1), halfW, halfH, cardTarget);
    const textConfidence = sampleTextSignature(base, cardTarget, frame);
    const dataConfidence = 1;
    const wholeCardConfidence = clamp(
      whiteRatio * 0.32 + surroundDarkRatio * 0.42 + Math.min(1, textDarkRatio / 0.22) * 0.38,
      0,
      1
    );
    const pose = {
      ...base,
      markerRatios: [surroundDarkRatio, whiteRatio, textDarkRatio, 1],
      visibleMarkers: 4,
      wholeCardConfidence,
      textConfidence,
      dataConfidence,
      usesWholeCardTarget: true,
      source: "hiro-text-marker",
      recognizedText: cardTarget?.recognizedText || cardTarget?.markerText?.[0] || "",
      resolvedInstrument: cardTarget?.resolvedInstrument || cardTarget?.instrumentId || "synthesizer",
      decodedPayload: cardTarget?.encodedPayload || ""
    };
    if (!isRecognizedSynthCard(pose, textConfidence, dataConfidence, cardTarget)) continue;
    const score = wholeCardConfidence + textConfidence + Math.min(1, candidate.area / (frame.width * frame.height * 0.18));
    if (!best || score > best.score) best = { score, pose };
  }
  return best?.pose || null;
}

function isRecognizedSynthCard(pose, textConfidence, dataConfidence, cardTarget) {
  if (!pose) return false;
  const policy = cardTarget?.recognition || {};
  const markerConfidence = pose.wholeCardConfidence ?? Math.min(1, (pose.visibleMarkers || 0) / 4);
  const textMin = policy.minTextConfidence ?? cardTarget?.textSignatureMinConfidence ?? 0.42;
  const dataMin = policy.minDataConfidence ?? cardTarget?.dataSignature?.minConfidence ?? 0.48;
  const combinedMin = policy.minCombinedConfidence ?? 0.54;
  const cornerMin = policy.minCornerConfidence ?? 0.44;
  const hasText = textConfidence >= textMin;
  const hasData = dataConfidence >= dataMin;
  const combined = markerConfidence * 0.48 + textConfidence * 0.34 + dataConfidence * 0.18;
  if (markerConfidence >= 0.96 && textConfidence >= textMin * 0.72) return true;
  if (markerConfidence >= cornerMin && (hasText || hasData) && combined >= combinedMin) return true;
  return markerConfidence >= 0.72 && textConfidence >= textMin * 0.82 && dataConfidence >= dataMin * 0.72;
}

function point(x = 0, y = 0) {
  return { x, y };
}

function add(a, b) {
  return point(a.x + b.x, a.y + b.y);
}

function sub(a, b) {
  return point(a.x - b.x, a.y - b.y);
}

function mul(a, n) {
  return point(a.x * n, a.y * n);
}

function length(a) {
  return Math.hypot(a.x, a.y) || 1;
}

function normalize(a) {
  return mul(a, 1 / length(a));
}

function average(points) {
  return mul(points.reduce((sum, p) => add(sum, p), point()), 1 / points.length);
}

function sampleDarkRatio(frame, center, radius) {
  if (!frame?.imageData?.data || !frame.width || !frame.height) return 0;

  const data = frame.imageData.data;
  let dark = 0;
  let total = 0;
  const minX = Math.max(0, Math.floor(center.x - radius));
  const maxX = Math.min(frame.width - 1, Math.ceil(center.x + radius));
  const minY = Math.max(0, Math.floor(center.y - radius));
  const maxY = Math.min(frame.height - 1, Math.ceil(center.y + radius));

  for (let y = minY; y <= maxY; y += 2) {
    for (let x = minX; x <= maxX; x += 2) {
      const i = (y * frame.width + x) * 4;
      const luminance = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      if (luminance < 82) dark += 1;
      total += 1;
    }
  }

  return total ? dark / total : 0;
}

function geometryFromLocation(location, cardTarget) {
  const tl = location.topLeftCorner;
  const tr = location.topRightCorner;
  const br = location.bottomRightCorner;
  const bl = location.bottomLeftCorner;
  if (!tl || !tr || !br || !bl) return null;
  const cardCenter = average([tl, tr, br, bl]);
  const xAxisRaw = average([sub(tr, tl), sub(br, bl)]);
  const yAxisRaw = average([sub(bl, tl), sub(br, tr)]);
  const halfW = (length(sub(tr, tl)) + length(sub(br, bl))) * 0.25;
  const halfH = (length(sub(bl, tl)) + length(sub(br, tr))) * 0.25;
  return makeGeometry(cardCenter, normalize(xAxisRaw), normalize(yAxisRaw), halfW, halfH, cardTarget);
}

function makeGeometry(cardCenter, xUnit, yUnit, halfW, halfH, cardTarget) {
  const qrCenterOffset = (cardTarget?.qrCenterYOffset || 0) * halfH * 2;
  const anchorMode = cardTarget?.anchor?.anchorMode;
  const anchorCenter = anchorMode === "qr-center" || anchorMode === "card-center"
    ? add(cardCenter, mul(yUnit, -qrCenterOffset))
    : cardCenter;
  const corners = {
    topLeftCorner: add(add(cardCenter, mul(xUnit, -halfW)), mul(yUnit, -halfH)),
    topRightCorner: add(add(cardCenter, mul(xUnit, halfW)), mul(yUnit, -halfH)),
    bottomRightCorner: add(add(cardCenter, mul(xUnit, halfW)), mul(yUnit, halfH)),
    bottomLeftCorner: add(add(cardCenter, mul(xUnit, -halfW)), mul(yUnit, halfH))
  };

  const markerRatio = cardTarget?.cornerMarkerRatio || { x: 0.84, y: 0.855 };
  const markerCenters = [
    add(add(cardCenter, mul(xUnit, -halfW * markerRatio.x)), mul(yUnit, -halfH * markerRatio.y)),
    add(add(cardCenter, mul(xUnit, halfW * markerRatio.x)), mul(yUnit, -halfH * markerRatio.y)),
    add(add(cardCenter, mul(xUnit, halfW * markerRatio.x)), mul(yUnit, halfH * markerRatio.y)),
    add(add(cardCenter, mul(xUnit, -halfW * markerRatio.x)), mul(yUnit, halfH * markerRatio.y))
  ];
  return {
    location: corners,
    center: cardCenter,
    anchorCenter,
    xUnit,
    yUnit,
    halfW,
    halfH,
    markerCenters,
  };
}

function locateDarkMarker(frame, center, radius) {
  if (!frame?.imageData?.data || !frame.width || !frame.height) return null;

  const data = frame.imageData.data;
  let dark = 0;
  let total = 0;
  let weightTotal = 0;
  let sumX = 0;
  let sumY = 0;
  const minX = Math.max(0, Math.floor(center.x - radius));
  const maxX = Math.min(frame.width - 1, Math.ceil(center.x + radius));
  const minY = Math.max(0, Math.floor(center.y - radius));
  const maxY = Math.min(frame.height - 1, Math.ceil(center.y + radius));

  for (let y = minY; y <= maxY; y += 2) {
    for (let x = minX; x <= maxX; x += 2) {
      const i = (y * frame.width + x) * 4;
      const luminance = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      if (luminance < 96) {
        const weight = 1 + (96 - luminance) / 96;
        dark += 1;
        weightTotal += weight;
        sumX += x * weight;
        sumY += y * weight;
      }
      total += 1;
    }
  }

  const darkRatio = total ? dark / total : 0;
  if (dark < 10 || darkRatio < 0.045 || !weightTotal) return null;
  return {
    x: sumX / weightTotal,
    y: sumY / weightTotal,
    darkRatio,
    confidence: Math.min(1, darkRatio * 3.2)
  };
}

function findDarkSquareCandidates(frame) {
  const step = Math.max(4, Math.round(Math.min(frame.width, frame.height) / 170));
  const gridW = Math.ceil(frame.width / step);
  const gridH = Math.ceil(frame.height / step);
  const dark = new Uint8Array(gridW * gridH);
  const seen = new Uint8Array(gridW * gridH);
  const data = frame.imageData.data;

  for (let gy = 0; gy < gridH; gy++) {
    const y = Math.min(frame.height - 1, gy * step);
    for (let gx = 0; gx < gridW; gx++) {
      const x = Math.min(frame.width - 1, gx * step);
      const i = (y * frame.width + x) * 4;
      const luminance = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      if (luminance < 78) dark[gy * gridW + gx] = 1;
    }
  }

  const candidates = [];
  const stack = [];
  const minSide = Math.min(frame.width, frame.height);
  const minMarker = Math.max(16, minSide * 0.035);
  const maxMarker = Math.max(34, minSide * 0.18);

  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      const start = gy * gridW + gx;
      if (!dark[start] || seen[start]) continue;
      seen[start] = 1;
      stack.length = 0;
      stack.push(start);
      let count = 0;
      let minGX = gx;
      let maxGX = gx;
      let minGY = gy;
      let maxGY = gy;
      let sumX = 0;
      let sumY = 0;

      while (stack.length) {
        const idx = stack.pop();
        const cx = idx % gridW;
        const cy = Math.floor(idx / gridW);
        count += 1;
        sumX += cx;
        sumY += cy;
        minGX = Math.min(minGX, cx);
        maxGX = Math.max(maxGX, cx);
        minGY = Math.min(minGY, cy);
        maxGY = Math.max(maxGY, cy);

        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (Math.abs(ox) + Math.abs(oy) !== 1) continue;
            const nx = cx + ox;
            const ny = cy + oy;
            if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) continue;
            const next = ny * gridW + nx;
            if (!dark[next] || seen[next]) continue;
            seen[next] = 1;
            stack.push(next);
          }
        }
      }

      const width = (maxGX - minGX + 1) * step;
      const height = (maxGY - minGY + 1) * step;
      const aspect = width / Math.max(height, 1);
      const fill = count / Math.max((maxGX - minGX + 1) * (maxGY - minGY + 1), 1);
      if (
        width < minMarker || height < minMarker ||
        width > maxMarker || height > maxMarker ||
        aspect < 0.58 || aspect > 1.72 ||
        fill < 0.16
      ) continue;

      candidates.push({
        x: ((sumX / count) + 0.5) * step,
        y: ((sumY / count) + 0.5) * step,
        darkRatio: Math.min(1, fill),
        confidence: Math.min(1, fill * 2.4),
        area: count * step * step,
        width,
        height
      });
    }
  }

  return candidates
    .sort((a, b) => b.area - a.area)
    .slice(0, 36);
}

function findBrightPanelCandidates(frame) {
  const step = Math.max(4, Math.round(Math.min(frame.width, frame.height) / 180));
  const gridW = Math.ceil(frame.width / step);
  const gridH = Math.ceil(frame.height / step);
  const bright = new Uint8Array(gridW * gridH);
  const seen = new Uint8Array(gridW * gridH);
  const data = frame.imageData.data;

  for (let gy = 0; gy < gridH; gy += 1) {
    const y = Math.min(frame.height - 1, gy * step);
    for (let gx = 0; gx < gridW; gx += 1) {
      const x = Math.min(frame.width - 1, gx * step);
      const i = (y * frame.width + x) * 4;
      const luminance = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      if (luminance > 178) bright[gy * gridW + gx] = 1;
    }
  }

  const candidates = [];
  const stack = [];
  const minSide = Math.min(frame.width, frame.height);
  const minPanelW = Math.max(54, minSide * 0.16);
  const minPanelH = Math.max(44, minSide * 0.10);
  const maxPanelW = frame.width * 0.78;
  const maxPanelH = frame.height * 0.62;

  for (let gy = 0; gy < gridH; gy += 1) {
    for (let gx = 0; gx < gridW; gx += 1) {
      const start = gy * gridW + gx;
      if (!bright[start] || seen[start]) continue;
      seen[start] = 1;
      stack.length = 0;
      stack.push(start);
      let count = 0;
      let minGX = gx;
      let maxGX = gx;
      let minGY = gy;
      let maxGY = gy;
      let sumX = 0;
      let sumY = 0;

      while (stack.length) {
        const idx = stack.pop();
        const cx = idx % gridW;
        const cy = Math.floor(idx / gridW);
        count += 1;
        sumX += cx;
        sumY += cy;
        minGX = Math.min(minGX, cx);
        maxGX = Math.max(maxGX, cx);
        minGY = Math.min(minGY, cy);
        maxGY = Math.max(maxGY, cy);

        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            if (Math.abs(ox) + Math.abs(oy) !== 1) continue;
            const nx = cx + ox;
            const ny = cy + oy;
            if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) continue;
            const next = ny * gridW + nx;
            if (!bright[next] || seen[next]) continue;
            seen[next] = 1;
            stack.push(next);
          }
        }
      }

      const width = (maxGX - minGX + 1) * step;
      const height = (maxGY - minGY + 1) * step;
      if (width < minPanelW || height < minPanelH || width > maxPanelW || height > maxPanelH) continue;
      const fill = count / Math.max((maxGX - minGX + 1) * (maxGY - minGY + 1), 1);
      if (fill < 0.38) continue;
      candidates.push({
        x: ((sumX / count) + 0.5) * step,
        y: ((sumY / count) + 0.5) * step,
        width,
        height,
        area: count * step * step,
        fill,
        bounds: {
          x: minGX * step,
          y: minGY * step,
          w: width,
          h: height
        }
      });
    }
  }

  return candidates
    .sort((a, b) => (b.area * b.fill) - (a.area * a.fill))
    .slice(0, 12);
}

function insetBounds(bounds, insetRatio) {
  const dx = bounds.w * insetRatio;
  const dy = bounds.h * insetRatio;
  return {
    x: bounds.x + dx,
    y: bounds.y + dy,
    w: Math.max(1, bounds.w - dx * 2),
    h: Math.max(1, bounds.h - dy * 2)
  };
}

function sampleRectDarkRatio(frame, bounds, threshold = 104) {
  if (!frame?.imageData?.data) return 0;
  const data = frame.imageData.data;
  const minX = Math.max(0, Math.floor(bounds.x));
  const maxX = Math.min(frame.width - 1, Math.ceil(bounds.x + bounds.w));
  const minY = Math.max(0, Math.floor(bounds.y));
  const maxY = Math.min(frame.height - 1, Math.ceil(bounds.y + bounds.h));
  let dark = 0;
  let total = 0;
  for (let y = minY; y <= maxY; y += 3) {
    for (let x = minX; x <= maxX; x += 3) {
      const i = (y * frame.width + x) * 4;
      const luminance = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      if (luminance < threshold) dark += 1;
      total += 1;
    }
  }
  return total ? dark / total : 0;
}

function sampleRectRingDarkRatio(frame, bounds, expandRatio = 0.32) {
  const dx = bounds.w * expandRatio;
  const dy = bounds.h * expandRatio;
  const outer = {
    x: bounds.x - dx,
    y: bounds.y - dy,
    w: bounds.w + dx * 2,
    h: bounds.h + dy * 2
  };
  const outerRatio = sampleRectDarkRatio(frame, outer, 112);
  const innerRatio = sampleRectDarkRatio(frame, bounds, 112);
  const outerArea = Math.max(1, outer.w * outer.h);
  const innerArea = Math.max(1, bounds.w * bounds.h);
  const ringArea = Math.max(1, outerArea - innerArea);
  return clamp((outerRatio * outerArea - innerRatio * innerArea) / ringArea, 0, 1);
}

function chooseExtremeCorners(candidates) {
  const topLeft = candidates.reduce((best, item) => !best || item.x + item.y < best.x + best.y ? item : best, null);
  const topRight = candidates.reduce((best, item) => !best || item.x - item.y > best.x - best.y ? item : best, null);
  const bottomRight = candidates.reduce((best, item) => !best || item.x + item.y > best.x + best.y ? item : best, null);
  const bottomLeft = candidates.reduce((best, item) => !best || item.y - item.x > best.y - best.x ? item : best, null);
  const corners = [topLeft, topRight, bottomRight, bottomLeft];
  if (new Set(corners).size !== 4) return null;
  return corners.map((corner, index) => ({ ...corner, index }));
}

function chooseBestCardCorners(candidates, cardTarget, frame) {
  const limited = candidates
    .slice()
    .sort((a, b) => (b.area * b.confidence) - (a.area * a.confidence))
    .slice(0, 22);
  const markerRatio = cardTarget?.cornerMarkerRatio || { x: 0.84, y: 0.855 };
  const expectedAspect = cardTarget?.cardAspect || 1250 / 1390;
  let best = null;

  for (let a = 0; a < limited.length - 3; a += 1) {
    for (let b = a + 1; b < limited.length - 2; b += 1) {
      for (let c = b + 1; c < limited.length - 1; c += 1) {
        for (let d = c + 1; d < limited.length; d += 1) {
          const ordered = orderCorners([limited[a], limited[b], limited[c], limited[d]]);
          if (!ordered) continue;
          const base = geometryFromMarkerCenters(ordered, markerRatio, cardTarget);
          if (!base) continue;
          const width = base.halfW * 2;
          const height = base.halfH * 2;
          const aspect = width / Math.max(height, 1);
          if (aspect < expectedAspect * 0.70 || aspect > expectedAspect * 1.42) continue;
          const area = polygonArea(ordered);
          const minFrameArea = frame.width * frame.height * 0.018;
          if (area < minFrameArea) continue;
          const refined = refinePoseFromMarkers(base, ordered, markerRatio, frame, cardTarget, "text-card-candidate");
          if (!refined) continue;
          const textConfidence = sampleTextSignature(refined, cardTarget, frame);
          const dataConfidence = sampleDataSignature(refined, cardTarget, frame);
          const markerConfidence = refined.wholeCardConfidence ?? 0;
          if (!isRecognizedSynthCard(refined, textConfidence, dataConfidence, cardTarget)) continue;
          const score = markerConfidence * 2.4 + textConfidence * 2.0 + dataConfidence * 1.1 + Math.min(1, area / (frame.width * frame.height * 0.20));
          if (!best || score > best.score) {
            best = { score, corners: ordered };
          }
        }
      }
    }
  }

  return best?.corners || null;
}

function orderCorners(points) {
  if (points.length !== 4) return null;
  const center = average(points);
  const sorted = points
    .slice()
    .sort((a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x));
  let tlIndex = 0;
  let minSum = Infinity;
  sorted.forEach((point, index) => {
    const sum = point.x + point.y;
    if (sum < minSum) {
      minSum = sum;
      tlIndex = index;
    }
  });
  const ordered = sorted.slice(tlIndex).concat(sorted.slice(0, tlIndex));
  if (polygonArea(ordered) < 0) ordered.reverse();
  const normalized = ordered.map((corner, index) => ({ ...corner, index }));
  const [tl, tr, br, bl] = normalized;
  if (length(sub(tr, tl)) < 24 || length(sub(br, bl)) < 24 || length(sub(bl, tl)) < 30 || length(sub(br, tr)) < 30) return null;
  return normalized;
}

function polygonArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) * 0.5;
}

function geometryFromMarkerCenters(markers, markerRatio, cardTarget) {
  const [tl, tr, br, bl] = markers;
  const top = length(sub(tr, tl));
  const bottom = length(sub(br, bl));
  const left = length(sub(bl, tl));
  const right = length(sub(br, tr));
  const cardWidthFromMarkers = (top + bottom) * 0.5 / markerRatio.x;
  const cardHeightFromMarkers = (left + right) * 0.5 / markerRatio.y;
  if (cardWidthFromMarkers < 60 || cardHeightFromMarkers < 70) return null;

  const aspect = cardWidthFromMarkers / cardHeightFromMarkers;
  const expectedAspect = cardTarget?.cardAspect || 1250 / 1390;
  if (aspect < expectedAspect * 0.58 || aspect > expectedAspect * 1.72) return null;

  const xAxis = average([sub(tr, tl), sub(br, bl)]);
  const yAxis = average([sub(bl, tl), sub(br, tr)]);
  const centerEstimates = markers.map((marker) => {
    const signs = [[-1, -1], [1, -1], [1, 1], [-1, 1]][marker.index];
    const offset = add(
      mul(normalize(xAxis), signs[0] * cardWidthFromMarkers * 0.5 * markerRatio.x),
      mul(normalize(yAxis), signs[1] * cardHeightFromMarkers * 0.5 * markerRatio.y)
    );
    return sub(marker, offset);
  });
  return makeGeometry(
    average(centerEstimates),
    normalize(xAxis),
    normalize(yAxis),
    cardWidthFromMarkers * 0.5,
    cardHeightFromMarkers * 0.5,
    cardTarget
  );
}

function sampleTextSignature(pose, cardTarget, frame) {
  const regions = cardTarget?.textSignatureRegions || [];
  if (!regions.length) return 0;
  let passed = 0;
  let confidence = 0;
  for (const region of regions) {
    const ratio = sampleCardRegionDarkRatio(pose, frame, region);
    const ok = ratio >= (region.minDarkRatio ?? 0.035);
    if (ok) passed += 1;
    confidence += Math.min(1, ratio / Math.max(region.minDarkRatio ?? 0.035, 0.001));
  }
  const averageConfidence = confidence / regions.length;
  return passed >= Math.max(1, regions.length - 1)
    ? averageConfidence
    : averageConfidence * 0.58;
}

function sampleDataSignature(pose, cardTarget, frame) {
  const signature = cardTarget?.dataSignature;
  if (!signature?.bits || !frame?.imageData?.data) return 1;
  const bits = String(signature.bits);
  let score = 0;
  for (let index = 0; index < bits.length; index += 1) {
    const bit = bits[index];
    const region = {
      x: signature.x + (signature.w / bits.length) * index + signature.w / bits.length * 0.18,
      y: signature.y,
      w: signature.w / bits.length * 0.64,
      h: signature.h,
      cols: 3,
      rows: 4
    };
    const ratio = sampleCardRegionDarkRatio(pose, frame, region);
    if (bit === "1") {
      score += ratio >= (signature.oneMinDarkRatio ?? 0.18) ? 1 : Math.max(0, ratio / (signature.oneMinDarkRatio ?? 0.18));
    } else {
      const limit = signature.zeroMaxDarkRatio ?? 0.13;
      score += ratio <= limit ? 1 : Math.max(0, 1 - (ratio - limit) / Math.max(limit, 0.01));
    }
  }
  return score / bits.length;
}

function sampleCardRegionDarkRatio(pose, frame, region) {
  const cols = region.cols || 24;
  const rows = region.rows || 8;
  let dark = 0;
  let total = 0;
  const data = frame.imageData.data;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const nx = region.x + ((col + 0.5) / cols) * region.w;
      const ny = region.y + ((row + 0.5) / rows) * region.h;
      const p = add(
        add(pose.center, mul(pose.xUnit, (nx - 0.5) * pose.halfW * 2)),
        mul(pose.yUnit, (ny - 0.5) * pose.halfH * 2)
      );
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) continue;
      const i = (y * frame.width + x) * 4;
      const luminance = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      if (luminance < 108) dark += 1;
      total += 1;
    }
  }
  return total ? dark / total : 0;
}

function refinePoseFromMarkers(base, markers, markerRatio, frame, cardTarget, source) {
  const signs = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1]
  ];
  const visible = markers.filter(Boolean);
  const visibleMarkers = visible.filter((marker) => marker.darkRatio > 0.22 || marker.confidence > 0.35).length;
  const rawMarkerCount = visible.length;
  const markerRatios = markers.map((marker) => marker?.darkRatio || 0);
  if (rawMarkerCount < 2) {
    return {
      ...base,
      markerRatios,
      visibleMarkers,
      wholeCardConfidence: Math.max(visibleMarkers / 4, 0.12),
      usesWholeCardTarget: true,
      source
    };
  }

  let xUnit = base.xUnit;
  let yUnit = base.yUnit;
  let halfW = base.halfW;
  let halfH = base.halfH;

  const horizontalPairs = [[0, 1], [3, 2]]
    .map(([a, b]) => markers[a] && markers[b] ? sub(markers[b], markers[a]) : null)
    .filter(Boolean);
  if (horizontalPairs.length) {
    const xAxis = average(horizontalPairs);
    xUnit = normalize(xAxis);
    halfW = clamp(length(xAxis) / (2 * markerRatio.x), base.halfW * 0.72, base.halfW * 1.28);
  }

  const verticalPairs = [[0, 3], [1, 2]]
    .map(([a, b]) => markers[a] && markers[b] ? sub(markers[b], markers[a]) : null)
    .filter(Boolean);
  if (verticalPairs.length) {
    const yAxis = average(verticalPairs);
    yUnit = normalize(yAxis);
    halfH = clamp(length(yAxis) / (2 * markerRatio.y), base.halfH * 0.72, base.halfH * 1.28);
  }

  const centerEstimates = visible.map((marker) => {
    const [sx, sy] = signs[marker.index];
    const offset = add(mul(xUnit, sx * halfW * markerRatio.x), mul(yUnit, sy * halfH * markerRatio.y));
    return sub(marker, offset);
  });
  const cardCenter = average(centerEstimates);
  const refined = makeGeometry(cardCenter, xUnit, yUnit, halfW, halfH, cardTarget);
  return {
    ...refined,
    markerRatios,
    visibleMarkers,
    wholeCardConfidence: Math.max(visibleMarkers / 4, rawMarkerCount / 5, 0.18),
    usesWholeCardTarget: true,
    source
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
