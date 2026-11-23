import { COMPANY_BRAND } from './companyBrand';
import { formatBirthMonthDayLabel, getTodayIstParts } from './birthdayEngine';

export interface BirthdayCardInput {
  fullName: string;
  employeeId: string;
  branchName: string;
  departmentName?: string;
  designation?: string;
  photoDataUrl?: string;
  birthMonthDay: string; // MM-DD
  celebrationYear?: number;
}

function loadImageSafe(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawWrappedCenteredText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  startY: number,
  maxWidth: number,
  lineHeight: number,
): number {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);

  let y = startY;
  for (const line of lines) {
    ctx.fillText(line, cx, y);
    y += lineHeight;
  }
  return y;
}

/**
 * Renders an executive 1200x1500 House of Muktai Official Birthday Wishing Card PNG data URL
 * with native Unicode Marathi + English typography, ornate gold framing, and employee portrait.
 */
export async function renderOfficialBirthdayCardPngDataUrl(
  input: BirthdayCardInput,
): Promise<string> {
  const W = 1200;
  const H = 1500;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas rendering context unavailable.');

  const year = input.celebrationYear || getTodayIstParts().year;
  const dateLabel = `${formatBirthMonthDayLabel(input.birthMonthDay, 'en')} ${year}`;

  // 1. Deep Royal Navy Luxury Gradient Canvas
  const bgGrad = ctx.createLinearGradient(0, 0, W, H);
  bgGrad.addColorStop(0, '#09142A');
  bgGrad.addColorStop(0.5, '#0F1F3D');
  bgGrad.addColorStop(1, '#162C54');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // Subtle ambient warm champagne radial glow behind portrait
  const glow = ctx.createRadialGradient(W / 2, 540, 40, W / 2, 540, 460);
  glow.addColorStop(0, 'rgba(223, 194, 125, 0.20)');
  glow.addColorStop(0.55, 'rgba(184, 146, 58, 0.06)');
  glow.addColorStop(1, 'rgba(15, 31, 61, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Subtle decorative celebration sparkles (restrained & luxury)
  const goldDots: Array<[number, number, number, number]> = [
    [140, 210, 4, 0.45],
    [1055, 225, 5, 0.5],
    [210, 450, 3, 0.35],
    [990, 480, 4, 0.4],
    [165, 860, 3.5, 0.3],
    [1035, 830, 3.5, 0.35],
    [260, 1220, 3, 0.3],
    [940, 1240, 4, 0.35],
  ];
  for (const [dx, dy, r, alpha] of goldDots) {
    ctx.fillStyle = `rgba(223, 194, 125, ${alpha})`;
    ctx.beginPath();
    ctx.arc(dx, dy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 2. Ornate Double Royal Gold Border
  const goldGrad = ctx.createLinearGradient(0, 0, W, H);
  goldGrad.addColorStop(0, '#B8923A');
  goldGrad.addColorStop(0.5, '#F0DA9D');
  goldGrad.addColorStop(1, '#B8923A');

  drawRoundedRectPath(ctx, 44, 44, W - 88, H - 88, 28);
  ctx.lineWidth = 4;
  ctx.strokeStyle = goldGrad;
  ctx.stroke();

  drawRoundedRectPath(ctx, 64, 64, W - 128, H - 128, 20);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(223, 194, 125, 0.42)';
  ctx.stroke();

  // Corner diamond accents
  const corners: Array<[number, number]> = [
    [96, 96],
    [W - 96, 96],
    [96, H - 96],
    [W - 96, H - 96],
  ];
  ctx.fillStyle = '#DFC27D';
  for (const [cx, cy] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - 8);
    ctx.lineTo(cx + 8, cy);
    ctx.lineTo(cx, cy + 8);
    ctx.lineTo(cx - 8, cy);
    ctx.closePath();
    ctx.fill();
  }

  // 3. Company Crest & Logo Header
  const [logoImg, photoImg] = await Promise.all([
    loadImageSafe('/assets/aistudio/house-of-muktai-logo.png'),
    loadImageSafe(input.photoDataUrl || ''),
  ]);

  if (logoImg) {
    ctx.save();
    drawRoundedRectPath(ctx, W / 2 - 54, 108, 108, 108, 22);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.clip();
    ctx.drawImage(logoImg, W / 2 - 48, 114, 96, 96);
    ctx.restore();

    drawRoundedRectPath(ctx, W / 2 - 54, 108, 108, 108, 22);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#DFC27D';
    ctx.stroke();
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 34px "Plus Jakarta Sans", "Segoe UI", system-ui, sans-serif';
  ctx.fillText(COMPANY_BRAND.brandName.toUpperCase(), W / 2, 266);

  ctx.fillStyle = '#DFC27D';
  ctx.font = '600 18px "Plus Jakarta Sans", "Segoe UI", system-ui, sans-serif';
  ctx.fillText(COMPANY_BRAND.legalName, W / 2, 298);

  // Subtle gold divider rule
  ctx.strokeStyle = 'rgba(223, 194, 125, 0.45)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 180, 326);
  ctx.lineTo(W / 2 + 180, 326);
  ctx.stroke();

  // 4. Headline Banner
  ctx.fillStyle = '#F3DFAA';
  ctx.font = '700 56px Georgia, "Playfair Display", serif';
  ctx.fillText('Happy Birthday', W / 2, 404);

  ctx.fillStyle = '#E2E8F0';
  ctx.font = '600 28px "Noto Sans Devanagari", "Segoe UI", system-ui, sans-serif';
  ctx.fillText('वाढदिवसाच्या मनःपूर्वक शुभेच्छा!', W / 2, 450);

  // 5. Employee Circular Gold-Rimmed Portrait (or Monogram)
  const avatarR = 112;
  const avatarCy = 602;

  ctx.save();
  ctx.beginPath();
  ctx.arc(W / 2, avatarCy, avatarR + 8, 0, Math.PI * 2);
  ctx.lineWidth = 4;
  ctx.strokeStyle = goldGrad;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(W / 2, avatarCy, avatarR, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = '#1E3A5F';
  ctx.fill();
  ctx.clip();

  if (photoImg) {
    const scale = Math.max((avatarR * 2) / photoImg.width, (avatarR * 2) / photoImg.height);
    const drawW = photoImg.width * scale;
    const drawH = photoImg.height * scale;
    ctx.drawImage(photoImg, W / 2 - drawW / 2, avatarCy - drawH / 2, drawW, drawH);
  } else {
    const parts = input.fullName.trim().split(/\s+/);
    const initials = ((parts[0]?.[0] || 'H') + (parts[1]?.[0] || parts[0]?.[1] || 'M')).toUpperCase();
    ctx.fillStyle = '#DFC27D';
    ctx.font = '700 72px "Plus Jakarta Sans", "Segoe UI", system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials, W / 2, avatarCy + 4);
    ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();

  // 6. Employee Name & Branch Metadata
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 44px "Plus Jakarta Sans", "Segoe UI", system-ui, sans-serif';
  const afterNameY = drawWrappedCenteredText(ctx, input.fullName, W / 2, 782, W - 220, 52);

  const metaSegments = [
    input.designation || 'Team Member',
    input.branchName,
    input.departmentName || '',
  ].filter(Boolean);

  ctx.fillStyle = '#DFC27D';
  ctx.font = '600 22px "Plus Jakarta Sans", "Segoe UI", system-ui, sans-serif';
  const afterMetaY = drawWrappedCenteredText(
    ctx,
    metaSegments.join('  ·  '),
    W / 2,
    afterNameY + 6,
    W - 220,
    32,
  );

  // Date label
  ctx.fillStyle = '#94A3B8';
  ctx.font = '600 18px "Plus Jakarta Sans", "Segoe UI", system-ui, sans-serif';
  ctx.fillText(dateLabel, W / 2, afterMetaY + 12);

  // 7. Executive Bilingual Greeting Card Panel
  const boxY = Math.max(915, afterMetaY + 46);
  const boxH = 310;
  drawRoundedRectPath(ctx, 118, boxY, W - 236, boxH, 22);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(223, 194, 125, 0.35)';
  ctx.stroke();

  ctx.fillStyle = '#F8FAFC';
  ctx.font = '500 24px "Plus Jakarta Sans", "Segoe UI", system-ui, sans-serif';
  const afterEnY = drawWrappedCenteredText(
    ctx,
    'Wishing you wonderful health, happiness, and continued success. Thank you for your dedication and for being a cherished part of the House of Muktai family.',
    W / 2,
    boxY + 58,
    W - 316,
    36,
  );

  ctx.strokeStyle = 'rgba(223, 194, 125, 0.30)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 120, afterEnY + 8);
  ctx.lineTo(W / 2 + 120, afterEnY + 8);
  ctx.stroke();

  ctx.fillStyle = '#F3DFAA';
  ctx.font = '500 23px "Noto Sans Devanagari", "Segoe UI", system-ui, sans-serif';
  drawWrappedCenteredText(
    ctx,
    'तुम्हाला उत्तम आरोग्य, आनंद आणि उज्ज्वल यश लाभो. हाऊस ऑफ मुक्ताई परिवारातील तुमच्या योगदानाबद्दल मनःपूर्वक आभार!',
    W / 2,
    afterEnY + 52,
    W - 316,
    36,
  );

  // 8. Official Management Signature Footer
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '600 24px Georgia, serif';
  ctx.fillText('Warm Wishes · House of Muktai Management & 12-Branch Family', W / 2, H - 156);

  ctx.fillStyle = '#94A3B8';
  ctx.font = '500 17px "Plus Jakarta Sans", "Segoe UI", system-ui, sans-serif';
  ctx.fillText(
    `${COMPANY_BRAND.legalName} · Baramati, Pune · ${COMPANY_BRAND.portalDomain}`,
    W / 2,
    H - 114,
  );

  return canvas.toDataURL('image/png', 1.0);
}

export async function downloadOfficialBirthdayCardPng(input: BirthdayCardInput): Promise<void> {
  const dataUrl = await renderOfficialBirthdayCardPngDataUrl(input);
  const safeName = input.fullName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `house-of-muktai-birthday-card-${safeName || input.employeeId}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export async function downloadOfficialBirthdayCardPdf(input: BirthdayCardInput): Promise<void> {
  const dataUrl = await renderOfficialBirthdayCardPngDataUrl(input);
  const { default: jsPDF } = await import('jspdf');
  // A5 Portrait (148 x 210 mm) keepsake card with centered 4:5 luxury artwork
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' });
  doc.setFillColor(9, 20, 42);
  doc.rect(0, 0, 148, 210, 'F');
  doc.addImage(dataUrl, 'PNG', 6, 17.5, 136, 170);

  const safeName = input.fullName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  doc.save(`house-of-muktai-birthday-card-${safeName || input.employeeId}.pdf`);
}
