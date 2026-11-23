import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import PptxGenJS from 'pptxgenjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const LOGO_PATH = path.join(ROOT_DIR, 'public', 'assets', 'aistudio', 'house-of-muktai-logo.png');
const HEADER_LOGO_PATH = path.join(ROOT_DIR, 'public', 'pwa-192x192.png');
const OUTPUT_PATH = path.join(ROOT_DIR, 'public', 'House_of_Muktai_Training_Hindi.pptx');

// Brand Palette — House of Muktai Executive Corporate System
const C = {
  NAVY: '0F1F3D',
  NAVY_MID: '1E3A5F',
  NAVY_DARK: '091428',
  GOLD: 'B8923A',
  GOLD_LIGHT: 'DFC27D',
  GOLD_PALE: 'FBF6EA',
  GOLD_BORDER: 'E8D7AE',
  BG: 'F5F7FA',
  WHITE: 'FFFFFF',
  INK: '0F172A',
  SLATE: '334155',
  MUTED: '64748B',
  BORDER: 'DCE3EC',
  EMERALD: '047857',
  EMERALD_BG: 'ECFDF5',
  AMBER: 'B45309',
  AMBER_BG: 'FFFBEB',
  ROSE: 'BE123C',
  ROSE_BG: 'FFF1F2',
  BLUE_SOFT: 'EEF3FA',
};

const FONT = 'Nirmala UI';
const FONT_LATIN = 'Segoe UI';

const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5 in
pptx.author = 'House of Muktai — Shrimuktai Mart Private Limited';
pptx.company = 'SHRIMUKTAI MART PRIVATE LIMITED';
pptx.subject = 'Employee Incentive Management System — Hindi Training Presentation';
pptx.title = 'हाउस ऑफ मुक्ताई — इन्सेंटिव्ह मैनेजमेंट सिस्टम प्रशिक्षण';

const hasLogo = fs.existsSync(LOGO_PATH);
const hasHeaderLogo = fs.existsSync(HEADER_LOGO_PATH) || hasLogo;

function addStandardChrome(slide, slideNum, totalSlides, sectionTitle, slideTitle, subtitle) {
  slide.background = { color: C.BG };

  // Top gold accent hairline
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 0.08,
    fill: { color: C.GOLD },
    line: { color: C.GOLD, width: 0 },
  });

  // Top Header Navy Band
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0.08,
    w: 13.333,
    h: 1.12,
    fill: { color: C.NAVY },
    line: { color: C.NAVY, width: 0 },
  });

  // Section tag (unboxed gold typography)
  slide.addText(sectionTitle, {
    x: 0.6,
    y: 0.17,
    w: 9.8,
    h: 0.24,
    fontFace: FONT,
    fontSize: 10.5,
    bold: true,
    color: C.GOLD_LIGHT,
  });

  // Main Slide Heading
  slide.addText(slideTitle, {
    x: 0.6,
    y: 0.4,
    w: 10.4,
    h: 0.44,
    fontFace: FONT,
    fontSize: 21,
    bold: true,
    color: C.WHITE,
  });

  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.6,
      y: 0.84,
      w: 10.4,
      h: 0.28,
      fontFace: FONT,
      fontSize: 11,
      color: 'CBD5E1',
    });
  }

  // Logo badge top right
  if (hasHeaderLogo) {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 11.78,
      y: 0.2,
      w: 0.95,
      h: 0.88,
      rectRadius: 0.08,
      fill: { color: C.WHITE },
      line: { color: C.GOLD, width: 1 },
    });
    slide.addImage({
      path: fs.existsSync(HEADER_LOGO_PATH) ? HEADER_LOGO_PATH : LOGO_PATH,
      x: 11.86,
      y: 0.26,
      w: 0.79,
      h: 0.76,
      sizing: { type: 'contain', w: 0.79, h: 0.76 },
    });
  }

  // Footer Bar
  slide.addShape(pptx.ShapeType.line, {
    x: 0.6,
    y: 7.04,
    w: 12.133,
    h: 0,
    line: { color: C.BORDER, width: 0.75 },
  });
  slide.addText('HOUSE OF MUKTAI  ·  SHRIMUKTAI MART PRIVATE LIMITED  ·  आंतरिक प्रशिक्षण पुस्तिका', {
    x: 0.6,
    y: 7.1,
    w: 9.5,
    h: 0.28,
    fontFace: FONT,
    fontSize: 9.5,
    color: C.MUTED,
  });
  slide.addText(`स्लाइड ${slideNum} / ${totalSlides}`, {
    x: 10.9,
    y: 7.1,
    w: 1.83,
    h: 0.28,
    fontFace: FONT,
    fontSize: 9.5,
    bold: true,
    color: C.NAVY,
    align: 'right',
  });
}

function addCard(slide, x, y, w, h, opts = {}) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x,
    y,
    w,
    h,
    rectRadius: opts.radius ?? 0.09,
    fill: { color: opts.fill ?? C.WHITE },
    line: { color: opts.border ?? C.BORDER, width: opts.borderWidth ?? 1 },
  });
  if (opts.topBarColor) {
    slide.addShape(pptx.ShapeType.rect, {
      x: x + 0.04,
      y,
      w: w - 0.08,
      h: 0.055,
      fill: { color: opts.topBarColor },
      line: { color: opts.topBarColor, width: 0 },
    });
  }
}

const TOTAL = 14;

// ============================================================================
// SLIDE 1 — COVER SLIDE
// ============================================================================
{
  const s = pptx.addSlide();
  s.background = { color: C.NAVY };

  // Decorative architectural dark geometric accent on right
  s.addShape(pptx.ShapeType.rect, {
    x: 8.95,
    y: 0,
    w: 4.383,
    h: 7.5,
    fill: { color: C.NAVY_DARK },
    line: { color: C.NAVY_DARK, width: 0 },
  });
  // Top and bottom gold trims
  s.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 0.12,
    fill: { color: C.GOLD },
    line: { color: C.GOLD, width: 0 },
  });
  s.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 7.38,
    w: 13.333,
    h: 0.12,
    fill: { color: C.GOLD },
    line: { color: C.GOLD, width: 0 },
  });
  // Vertical gold hairline divider
  s.addShape(pptx.ShapeType.rect, {
    x: 8.93,
    y: 0.65,
    w: 0.03,
    h: 6.2,
    fill: { color: C.GOLD },
    line: { color: C.GOLD, width: 0 },
  });

  // Brand tag
  s.addText('HOUSE OF MUKTAI  ·  SHRIMUKTAI MART PRIVATE LIMITED', {
    x: 0.75,
    y: 0.85,
    w: 7.8,
    h: 0.35,
    fontFace: FONT_LATIN,
    fontSize: 12,
    bold: true,
    color: C.GOLD_LIGHT,
    charSpacing: 1.5,
  });

  // Main Hindi Title
  s.addText('कर्मचारी इन्सेंटिव्ह\nमैनेजमेंट सिस्टम', {
    x: 0.75,
    y: 1.45,
    w: 7.9,
    h: 2.0,
    fontFace: FONT,
    fontSize: 40,
    bold: true,
    color: C.WHITE,
    lineSpacingMultiple: 1.15,
  });

  // Gold accent bar under title
  s.addShape(pptx.ShapeType.rect, {
    x: 0.75,
    y: 3.55,
    w: 2.4,
    h: 0.06,
    fill: { color: C.GOLD },
    line: { color: C.GOLD, width: 0 },
  });

  // Subtitle
  s.addText('संपूर्ण प्रशिक्षण प्रेज़ेंटेशन (हिंदी संस्करण)', {
    x: 0.75,
    y: 3.8,
    w: 7.8,
    h: 0.5,
    fontFace: FONT,
    fontSize: 20,
    bold: true,
    color: C.GOLD_LIGHT,
  });

  s.addText(
    '12 रिटेल शाखाओं के लिए एडमिन वेब पैनल, एक्सेल इम्पोर्ट, ग्रोथ टार्गेट,\nपेआउट प्रबंधन और कर्मचारी मोबाइल ऐप का व्यावहारिक प्रशिक्षण।',
    {
      x: 0.75,
      y: 4.38,
      w: 7.7,
      h: 0.9,
      fontFace: FONT,
      fontSize: 14,
      color: 'CBD5E1',
      lineSpacingMultiple: 1.35,
    },
  );

  // Live Portal Info Cards on bottom left
  addCard(s, 0.75, 5.55, 3.75, 1.15, {
    fill: C.NAVY_MID,
    border: C.GOLD,
    borderWidth: 1,
  });
  s.addText('एडमिन वेब पोर्टल (सुपर एडमिन)', {
    x: 0.95,
    y: 5.7,
    w: 3.35,
    h: 0.32,
    fontFace: FONT,
    fontSize: 11.5,
    bold: true,
    color: C.GOLD_LIGHT,
  });
  s.addText('https://houseofmuktai.co.in', {
    x: 0.95,
    y: 6.08,
    w: 3.35,
    h: 0.4,
    fontFace: FONT_LATIN,
    fontSize: 13.5,
    bold: true,
    color: C.WHITE,
  });

  addCard(s, 4.72, 5.55, 3.85, 1.15, {
    fill: C.NAVY_MID,
    border: C.GOLD,
    borderWidth: 1,
  });
  s.addText('कर्मचारी मोबाइल ऐप (स्टाफ पोर्टल)', {
    x: 4.92,
    y: 5.7,
    w: 3.45,
    h: 0.32,
    fontFace: FONT,
    fontSize: 11.5,
    bold: true,
    color: C.GOLD_LIGHT,
  });
  s.addText('https://staff.houseofmuktai.co.in', {
    x: 4.92,
    y: 6.08,
    w: 3.45,
    h: 0.4,
    fontFace: FONT_LATIN,
    fontSize: 13.5,
    bold: true,
    color: C.WHITE,
  });

  // Right Panel: Official Logo + Key Facts
  if (hasLogo) {
    addCard(s, 9.75, 1.05, 2.8, 2.5, {
      fill: C.WHITE,
      border: C.GOLD,
      borderWidth: 2,
      radius: 0.14,
    });
    s.addImage({
      path: LOGO_PATH,
      x: 9.95,
      y: 1.2,
      w: 2.4,
      h: 2.2,
      sizing: { type: 'contain', w: 2.4, h: 2.2 },
    });
  }

  const coverFacts = [
    { num: '12', label: 'आधिकारिक रिटेल शाखाएँ' },
    { num: '100%', label: 'पारदर्शी और सुरक्षित डेटा' },
    { num: '24x7', label: 'मोबाइल ऐप पर लाइव रिपोर्ट' },
  ];
  coverFacts.forEach((f, idx) => {
    const y = 3.95 + idx * 0.92;
    s.addText(f.num, {
      x: 9.45,
      y,
      w: 1.1,
      h: 0.55,
      fontFace: FONT_LATIN,
      fontSize: 22,
      bold: true,
      color: C.GOLD_LIGHT,
      align: 'right',
    });
    s.addText(f.label, {
      x: 10.68,
      y: y + 0.08,
      w: 2.35,
      h: 0.42,
      fontFace: FONT,
      fontSize: 12.5,
      color: C.WHITE,
    });
  });

  s.addText('बारामती, पुणे — महाराष्ट्र 413102', {
    x: 9.2,
    y: 6.75,
    w: 3.85,
    h: 0.35,
    fontFace: FONT,
    fontSize: 10.5,
    color: '94A3B8',
    align: 'center',
  });

  s.addNotes(
    'स्वागत है! आज के इस प्रशिक्षण सत्र में हम हाउस ऑफ मुक्ताई (Shrimuktai Mart Pvt. Ltd.) के कर्मचारी इन्सेंटिव्ह मैनेजमेंट सिस्टम को पूरी तरह समझेंगे। इसमें एडमिन पैनल और कर्मचारी मोबाइल ऐप दोनों की स्टेप-बाय-स्टेप जानकारी शामिल है।',
  );
}

// ============================================================================
// SLIDE 2 — SYSTEM OVERVIEW & OBJECTIVES
// ============================================================================
{
  const s = pptx.addSlide();
  addStandardChrome(
    s,
    2,
    TOTAL,
    'अध्याय 01 · सिस्टम का परिचय',
    'यह सिस्टम क्यों बनाया गया है और इसके मुख्य लाभ क्या हैं?',
    'मैन्युअल एक्सेल और कागज़ी हिसाब की गलतियों को खत्म कर 12 शाखाओं के लिए एक आधुनिक डिजिटल प्रणाली',
  );

  const pillars = [
    {
      num: '01',
      title: '100% पारदर्शिता',
      desc: 'हर कर्मचारी अपने मोबाइल पर अपनी दैनिक व मासिक बिक्री, इन्सेंटिव्ह और पेआउट स्टेटस साफ-साफ देख सकता है।',
      bar: C.NAVY,
    },
    {
      num: '02',
      title: 'शून्य डुप्लीकेट गारंटी',
      desc: 'Business Date + Salesman No के आधार पर सिस्टम अपने-आप डुप्लीकेट और ओवरलैप एंट्री रोकता है।',
      bar: C.GOLD,
    },
    {
      num: '03',
      title: '12 शाखाओं का नियंत्रण',
      desc: 'बारामती से बीड, भोसरी, धाराशिव और पंढरपुर तक सभी 12 शाखाओं का लाइव तुलनात्मक विश्लेषण एक ही स्क्रीन पर।',
      bar: C.EMERALD,
    },
    {
      num: '04',
      title: 'बिक्री और ग्रोथ टार्गेट',
      desc: 'पिछले महीने की बिक्री पर % बढ़ाकर स्मार्ट टार्गेट सेट करें और एडमिन व कर्मचारी दोनों लाइव प्रोग्रेस देखें।',
      bar: C.NAVY_MID,
    },
  ];

  pillars.forEach((p, idx) => {
    const x = 0.6 + idx * 3.1;
    addCard(s, x, 1.5, 2.9, 2.55, { topBarColor: p.bar });
    s.addText(p.num, {
      x: x + 0.2,
      y: 1.7,
      w: 0.7,
      h: 0.4,
      fontFace: FONT_LATIN,
      fontSize: 20,
      bold: true,
      color: C.GOLD,
    });
    s.addText(p.title, {
      x: x + 0.2,
      y: 2.15,
      w: 2.5,
      h: 0.42,
      fontFace: FONT,
      fontSize: 14.5,
      bold: true,
      color: C.NAVY,
    });
    s.addText(p.desc, {
      x: x + 0.2,
      y: 2.65,
      w: 2.5,
      h: 1.25,
      fontFace: FONT,
      fontSize: 11.5,
      color: C.SLATE,
      lineSpacingMultiple: 1.32,
    });
  });

  // Before vs After Comparison Card
  addCard(s, 0.6, 4.35, 5.9, 2.45, { fill: C.ROSE_BG, border: 'FECDD3' });
  s.addText('पहले की समस्याएँ (मैन्युअल प्रक्रिया)', {
    x: 0.85,
    y: 4.5,
    w: 5.4,
    h: 0.38,
    fontFace: FONT,
    fontSize: 14,
    bold: true,
    color: C.ROSE,
  });
  s.addText(
    '• कर्मचारियों को महीने के अंत तक अपना इन्सेंटिव्ह पता नहीं चलता था।\n' +
      '• एक ही तारीख की एक्सेल दोबारा जुड़ने से गलत पेआउट का खतरा रहता था।\n' +
      '• अलग-अलग शाखाओं की तुलना और टार्गेट ट्रैक करने में बहुत समय लगता था।\n' +
      '• अकाउंट्स से पेमेंट होने के बाद भी स्टाफ बार-बार पूछताछ करता था।',
    {
      x: 0.85,
      y: 4.95,
      w: 5.4,
      h: 1.7,
      fontFace: FONT,
      fontSize: 11.5,
      color: C.INK,
      lineSpacingMultiple: 1.4,
    },
  );

  addCard(s, 6.83, 4.35, 5.9, 2.45, { fill: C.EMERALD_BG, border: 'A7F3D0' });
  s.addText('अब का समाधान (हाउस ऑफ मुक्ताई डिजिटल सिस्टम)', {
    x: 7.08,
    y: 4.5,
    w: 5.4,
    h: 0.38,
    fontFace: FONT,
    fontSize: 14,
    bold: true,
    color: C.EMERALD,
  });
  s.addText(
    '• एडमिन द्वारा पब्लिश करते ही कर्मचारी के मोबाइल पर तुरंत अपडेट।\n' +
      '• ऑटोमैटिक वैलिडेशन, ओवरलैप ब्लॉक और पूर्ण ऑडिट इतिहास।\n' +
      '• 1 क्लिक में 12 शाखाओं के चार्ट, लीडरबोर्ड और Excel/PDF रिपोर्ट्स।\n' +
      '• लाइव पेआउट स्टेटस (Paid/Pending) और इन-ऐप क्वेरी समाधान।',
    {
      x: 7.08,
      y: 4.95,
      w: 5.4,
      h: 1.7,
      fontFace: FONT,
      fontSize: 11.5,
      color: C.INK,
      lineSpacingMultiple: 1.4,
    },
  );

  s.addNotes(
    'इस स्लाइड में बताएं कि यह सिस्टम केवल हिसाब रखने का सॉफ्टवेयर नहीं है, बल्कि कर्मचारियों का भरोसा बढ़ाने और मैनेजमेंट का समय बचाने का पूरा डिजिटल समाधान है।',
  );
}

// ============================================================================
// SLIDE 3 — 12 OFFICIAL BRANCHES
// ============================================================================
{
  const s = pptx.addSlide();
  addStandardChrome(
    s,
    3,
    TOTAL,
    'अध्याय 02 · रिटेल नेटवर्क',
    'हाउस ऑफ मुक्ताई की 12 आधिकारिक शाखाएँ',
    'सभी 12 शाखाएँ सिस्टम में पहले से सिंक और प्रमाणित हैं — किसी डुप्लीकेट शाखा का निर्माण नहीं होता',
  );

  const branches = [
    { no: '01', name: 'BARAMATI MIDC', city: 'बारामती (पुणे)' },
    { no: '02', name: 'BARAMATI MOTIBAGH', city: 'बारामती (पुणे)' },
    { no: '03', name: 'BEED', city: 'बीड' },
    { no: '04', name: 'BHOSARI', city: 'भोसरी (पुणे)' },
    { no: '05', name: 'DHARASHIV', city: 'धाराशिव' },
    { no: '06', name: 'INDAPUR', city: 'इंदापूर' },
    { no: '07', name: 'LONAND', city: 'लोणंद' },
    { no: '08', name: 'PANDHARPUR', city: 'पंढरपूर' },
    { no: '09', name: 'PARANDA', city: 'परंडा' },
    { no: '10', name: 'RASHIN', city: 'राशिन' },
    { no: '11', name: 'SHRIGONDA', city: 'श्रीगोंदा' },
    { no: '12', name: 'SUPA', city: 'सुपा' },
  ];

  branches.forEach((b, idx) => {
    const col = idx % 4;
    const row = Math.floor(idx / 4);
    const x = 0.6 + col * 3.1;
    const y = 1.52 + row * 1.32;
    addCard(s, x, y, 2.9, 1.12, { topBarColor: row === 0 ? C.NAVY : row === 1 ? C.GOLD : C.NAVY_MID });
    s.addText(b.no, {
      x: x + 0.18,
      y: y + 0.2,
      w: 0.55,
      h: 0.35,
      fontFace: FONT_LATIN,
      fontSize: 15,
      bold: true,
      color: C.GOLD,
    });
    s.addText(b.name, {
      x: x + 0.72,
      y: y + 0.2,
      w: 2.08,
      h: 0.38,
      fontFace: FONT_LATIN,
      fontSize: 12,
      bold: true,
      color: C.NAVY,
    });
    s.addText(`स्थान: ${b.city}`, {
      x: x + 0.72,
      y: y + 0.62,
      w: 2.08,
      h: 0.32,
      fontFace: FONT,
      fontSize: 10.5,
      color: C.MUTED,
    });
  });

  // Smart ERP Normalization Highlight Box
  addCard(s, 0.6, 5.62, 12.133, 1.2, { fill: C.GOLD_PALE, border: C.GOLD_BORDER });
  s.addText('स्मार्ट ERP शाखा मैपिंग (Auto-Mapping सुरक्षा)', {
    x: 0.88,
    y: 5.76,
    w: 11.5,
    h: 0.34,
    fontFace: FONT,
    fontSize: 13.5,
    bold: true,
    color: C.NAVY,
  });
  s.addText(
    '• यदि ERP एक्सेल फ़ाइल में किसी शाखा के नाम की स्पेलिंग में थोड़ा अंतर हो (उदाहरण: "BARAMATI MOTIBAG"), तो सिस्टम उसे अपने-आप आधिकारिक शाखा "BARAMATI MOTIBAGH" से जोड़ देता है।\n' +
      '• इससे गलत या डुप्लीकेट शाखा नहीं बनती और शाखा-वार रिपोर्ट 100% सटीक रहती है।',
    {
      x: 0.88,
      y: 6.12,
      w: 11.5,
      h: 0.62,
      fontFace: FONT,
      fontSize: 11,
      color: C.SLATE,
      lineSpacingMultiple: 1.32,
    },
  );

  s.addNotes(
    'यहाँ हमारी सभी 12 आधिकारिक शाखाएँ दिखाई गई हैं। एडमिन को नई शाखा बनाने की जरूरत नहीं पड़ती क्योंकि सभी 12 शाखाएँ ऑटो-सिंक हैं और ERP स्पेलिंग अंतर को भी सिस्टम खुद संभालता है।',
  );
}

// ============================================================================
// SLIDE 4 — TWO PORTALS & ROLE-BASED ACCESS CONTROL
// ============================================================================
{
  const s = pptx.addSlide();
  addStandardChrome(
    s,
    4,
    TOTAL,
    'अध्याय 03 · पोर्टल संरचना एवं गोपनीयता',
    'दो अलग पोर्टल और सख्त डेटा सुरक्षा नियम (RBAC)',
    'एडमिन और कर्मचारियों के लिए अलग-अलग डोमेन, लॉगिन विधि और अनुमतियाँ',
  );

  // Left: Admin Panel
  addCard(s, 0.6, 1.5, 5.88, 4.15, { fill: C.NAVY, border: C.GOLD, borderWidth: 1.5 });
  s.addText('1. एडमिन वेब पैनल (सुपर एडमिन)', {
    x: 0.9,
    y: 1.72,
    w: 5.3,
    h: 0.42,
    fontFace: FONT,
    fontSize: 17,
    bold: true,
    color: C.GOLD_LIGHT,
  });
  s.addText('वेबसाइट:  https://houseofmuktai.co.in', {
    x: 0.9,
    y: 2.16,
    w: 5.3,
    h: 0.34,
    fontFace: FONT_LATIN,
    fontSize: 12.5,
    bold: true,
    color: C.WHITE,
  });
  s.addText(
    '• लॉगिन विधि: अधिकृत सुपर एडमिन Google अकाउंट से सुरक्षित लॉगिन।\n' +
      '• मुख्य अधिकार:\n' +
      '   - ERP एक्सेल अपलोड, वैलिडेशन, अप्रूवल और पब्लिश करना\n' +
      '   - कर्मचारियों को Active / Inactive करना व पासवर्ड रिसेट\n' +
      '   - 12 शाखाओं का एनालिटिक्स और ग्रोथ टार्गेट सेट करना\n' +
      '   - पेआउट को PAID मार्क करना और एडजस्टमेंट जोड़ना\n' +
      '   - कर्मचारी क्वेरी का उत्तर देना व ऑडिट लॉग / बैकअप लेना',
    {
      x: 0.9,
      y: 2.62,
      w: 5.3,
      h: 2.85,
      fontFace: FONT,
      fontSize: 12,
      color: 'E2E8F0',
      lineSpacingMultiple: 1.42,
    },
  );

  // Right: Staff Mobile App
  addCard(s, 6.85, 1.5, 5.88, 4.15, { fill: C.WHITE, border: C.NAVY, borderWidth: 1.5, topBarColor: C.GOLD });
  s.addText('2. कर्मचारी मोबाइल ऐप (Staff PWA)', {
    x: 7.15,
    y: 1.72,
    w: 5.3,
    h: 0.42,
    fontFace: FONT,
    fontSize: 17,
    bold: true,
    color: C.NAVY,
  });
  s.addText('वेबसाइट:  https://staff.houseofmuktai.co.in', {
    x: 7.15,
    y: 2.16,
    w: 5.3,
    h: 0.34,
    fontFace: FONT_LATIN,
    fontSize: 12.5,
    bold: true,
    color: C.GOLD,
  });
  s.addText(
    '• लॉगिन विधि: Salesman No (Employee ID) + व्यक्तिगत पासवर्ड।\n' +
      '• मुख्य सुविधाएँ:\n' +
      '   - केवल एडमिन द्वारा Published इन्सेंटिव्ह रिकॉर्ड्स देखना\n' +
      '   - दैनिक, मासिक और वार्षिक इन्सेंटिव्ह रिपोर्ट व चार्ट\n' +
      '   - अपना मासिक सेल्स टार्गेट और लाइव प्रोग्रेस देखना\n' +
      '   - अकाउंट्स पेआउट स्टेटस (Paid / Pending) व रसीद संदर्भ\n' +
      '   - किसी शंका के लिए सीधे क्वेरी (Query) भेजना व PDF डाउनलोड',
    {
      x: 7.15,
      y: 2.62,
      w: 5.3,
      h: 2.85,
      fontFace: FONT,
      fontSize: 12,
      color: C.SLATE,
      lineSpacingMultiple: 1.42,
    },
  );

  // Bottom Privacy Rule Banner
  addCard(s, 0.6, 5.85, 12.133, 0.96, { fill: C.BLUE_SOFT, border: 'BFDBFE' });
  s.addText(
    'डेटा गोपनीयता नियम: डेटाबेस स्तर (Firestore Security Rules) पर सख्त लॉक लगा है — कोई भी कर्मचारी URL या API बदलकर किसी अन्य कर्मचारी की बिक्री या इन्सेंटिव्ह जानकारी कभी नहीं देख सकता।',
    {
      x: 0.85,
      y: 6.02,
      w: 11.6,
      h: 0.62,
      fontFace: FONT,
      fontSize: 12,
      bold: true,
      color: C.NAVY,
      lineSpacingMultiple: 1.32,
    },
  );

  s.addNotes(
    'यहाँ स्पष्ट करें कि एडमिन और स्टाफ के पोर्टल पूरी तरह अलग हैं। स्टाफ को सिर्फ staff.houseofmuktai.co.in लिंक देना है जिसे वे अपने मोबाइल में ऐप की तरह इंस्टॉल कर सकते हैं।',
  );
}

// ============================================================================
// SLIDE 5 — ADMIN DASHBOARD WALKTHROUGH
// ============================================================================
{
  const s = pptx.addSlide();
  addStandardChrome(
    s,
    5,
    TOTAL,
    'अध्याय 04 · एडमिन पैनल प्रशिक्षण',
    'एडमिन डैशबोर्ड: 4 मुख्य KPI कार्ड्स और त्वरित नियंत्रण',
    'लॉगिन करते ही महीने की पूरी वित्तीय स्थिति एक नज़र में — स्पष्ट और अलग-अलग कार्ड्स में',
  );

  const kpis = [
    {
      title: 'Published Incentive',
      hindi: 'प्रकाशित इन्सेंटिव्ह',
      desc: 'चयनित महीने में कर्मचारियों को प्रकाशित कुल इन्सेंटिव्ह राशि और कुल रिकॉर्ड्स की संख्या।',
      dark: true,
    },
    {
      title: 'Total Sale Amount',
      hindi: 'कुल बिक्री राशि (₹)',
      desc: 'सभी शाखाओं की कुल प्रकाशित बिक्री राशि और प्रति कर्मचारी औसत बिक्री।',
      dark: false,
      bar: C.GOLD,
    },
    {
      title: 'Total Sale Qty',
      hindi: 'कुल बिक्री नग (Units)',
      desc: 'बेचे गए कुल उत्पादों (Units) की संख्या और प्रति कर्मचारी औसत नग।',
      dark: false,
      bar: C.NAVY,
    },
    {
      title: 'Incentive Ratio',
      hindi: 'इन्सेंटिव्ह अनुपात (%)',
      desc: 'कुल बिक्री पर दिया गया इन्सेंटिव्ह प्रतिशत (उदा. प्रति ₹100 बिक्री पर कितना ₹ इन्सेंटिव्ह)।',
      dark: false,
      bar: C.EMERALD,
    },
  ];

  kpis.forEach((k, idx) => {
    const x = 0.6 + idx * 3.1;
    addCard(s, x, 1.5, 2.9, 2.38, {
      fill: k.dark ? C.NAVY : C.WHITE,
      border: k.dark ? C.GOLD : C.BORDER,
      topBarColor: k.dark ? C.GOLD : k.bar,
    });
    s.addText(k.title, {
      x: x + 0.18,
      y: 1.72,
      w: 2.54,
      h: 0.3,
      fontFace: FONT_LATIN,
      fontSize: 11,
      bold: true,
      color: k.dark ? C.GOLD_LIGHT : C.MUTED,
    });
    s.addText(k.hindi, {
      x: x + 0.18,
      y: 2.04,
      w: 2.54,
      h: 0.4,
      fontFace: FONT,
      fontSize: 14.5,
      bold: true,
      color: k.dark ? C.WHITE : C.NAVY,
    });
    s.addText(k.desc, {
      x: x + 0.18,
      y: 2.52,
      w: 2.54,
      h: 1.2,
      fontFace: FONT,
      fontSize: 11,
      color: k.dark ? 'CBD5E1' : C.SLATE,
      lineSpacingMultiple: 1.35,
    });
  });

  // Operational Quick Strip + Top Bar features
  addCard(s, 0.6, 4.15, 7.25, 2.65);
  s.addText('डैशबोर्ड के निचले हिस्से की क्विक-एक्शन स्ट्रिप (1-क्लिक नेविगेशन)', {
    x: 0.85,
    y: 4.32,
    w: 6.75,
    h: 0.36,
    fontFace: FONT,
    fontSize: 13.5,
    bold: true,
    color: C.NAVY,
  });
  s.addText(
    '1. All-Time Incentive — अब तक का कुल प्रकाशित इन्सेंटिव्ह (हिस्ट्री टैब खोलें)\n' +
      '2. Active Employees — सक्रिय कर्मचारियों की संख्या (एम्प्लॉई मास्टर खोलें)\n' +
      '3. Retail Branches — सभी 12 शाखाओं की स्थिति (ब्रांच मास्टर खोलें)\n' +
      '4. Pending Batches — अप्रूवल के लिए लंबित एक्सेल बैच\n' +
      '5. Open Queries — कर्मचारियों द्वारा भेजे गए अनसुलझे प्रश्न',
    {
      x: 0.85,
      y: 4.76,
      w: 6.75,
      h: 1.9,
      fontFace: FONT,
      fontSize: 11.5,
      color: C.SLATE,
      lineSpacingMultiple: 1.42,
    },
  );

  addCard(s, 8.1, 4.15, 4.633, 2.65, { fill: C.GOLD_PALE, border: C.GOLD_BORDER });
  s.addText('टॉप बार के स्मार्ट टूल्स', {
    x: 8.35,
    y: 4.32,
    w: 4.15,
    h: 0.36,
    fontFace: FONT,
    fontSize: 13.5,
    bold: true,
    color: C.NAVY,
  });
  s.addText(
    '• Global Search (Ctrl + K):\n  किसी भी कर्मचारी, शाखा या बैच को तुरंत खोजें।\n' +
      '• Notification Bell:\n  पेंडिंग बैच और नई क्वेरी के अलर्ट देखें।\n' +
      '• Staff App Link कॉपी:\n  1 क्लिक में स्टाफ ऐप लिंक WhatsApp पर भेजें।\n' +
      '• Month Filter:\n  किसी भी महीने का डेटा तुरंत फ़िल्टर करें।',
    {
      x: 8.35,
      y: 4.74,
      w: 4.15,
      h: 1.95,
      fontFace: FONT,
      fontSize: 11,
      color: C.INK,
      lineSpacingMultiple: 1.32,
    },
  );

  s.addNotes(
    'एडमिन डैशबोर्ड पर अब चारों मुख्य आँकड़े — Published Incentive, Sale Amount, Sale Qty और Incentive Ratio — अलग-अलग कार्ड्स में धीमे एनिमेटेड ग्राफिक्स के साथ दिखाई देते हैं।',
  );
}

// ============================================================================
// SLIDE 6 — EXCEL IMPORT WORKFLOW
// ============================================================================
{
  const s = pptx.addSlide();
  addStandardChrome(
    s,
    6,
    TOTAL,
    'अध्याय 05 · डेटा अपलोड प्रक्रिया',
    'ERP एक्सेल अपलोड और पब्लिश वर्कफ़्लो (5 आसान चरण)',
    'केवल .xlsx फ़ाइल सपोर्ट — ऑटोमैटिक डेटा जाँच के बाद ही कर्मचारी मोबाइल ऐप पर डेटा दिखता है',
  );

  const steps = [
    {
      step: 'चरण 1',
      title: 'एक्सेल फ़ाइल चुनें',
      desc: 'Excel Upload टैब में ERP से निकाली गई .xlsx फ़ाइल अपलोड करें (अधिकतम 10 MB)।',
    },
    {
      step: 'चरण 2',
      title: 'पीरियड पहचान',
      desc: 'सिस्टम फ़ाइल के बैनर से तारीख पढ़कर Daily, Monthly या Custom Period अपने-आप पहचानता है।',
    },
    {
      step: 'चरण 3',
      title: 'कॉलम वैलिडेशन',
      desc: 'Branch, Salesman No, नाम, Sale Amt, Sale Qty और 3 स्लैब इन्सेंटिव्ह की ऑटो जाँच।',
    },
    {
      step: 'चरण 4',
      title: 'डुप्लीकेट व अलर्ट समीक्षा',
      desc: 'डुप्लीकेट, ओवरलैप, ब्रांच ट्रांसफर या SMPL पंक्तियों पर स्पष्ट निर्णय (Skip / Correct)।',
    },
    {
      step: 'चरण 5',
      title: 'अप्रूव और पब्लिश',
      desc: 'सुपर एडमिन की मंजूरी मिलते ही डेटा सुरक्षित सेव होता है और स्टाफ ऐप पर लाइव दिखता है।',
    },
  ];

  steps.forEach((st, idx) => {
    const x = 0.6 + idx * 2.47;
    addCard(s, x, 1.55, 2.27, 2.75, { topBarColor: idx === 4 ? C.EMERALD : C.NAVY });
    s.addText(st.step, {
      x: x + 0.16,
      y: 1.72,
      w: 1.95,
      h: 0.3,
      fontFace: FONT,
      fontSize: 11,
      bold: true,
      color: idx === 4 ? C.EMERALD : C.GOLD,
    });
    s.addText(st.title, {
      x: x + 0.16,
      y: 2.06,
      w: 1.95,
      h: 0.48,
      fontFace: FONT,
      fontSize: 13.5,
      bold: true,
      color: C.NAVY,
    });
    s.addText(st.desc, {
      x: x + 0.16,
      y: 2.62,
      w: 1.95,
      h: 1.5,
      fontFace: FONT,
      fontSize: 11,
      color: C.SLATE,
      lineSpacingMultiple: 1.35,
    });
    if (idx < 4) {
      s.addText('→', {
        x: x + 2.27,
        y: 2.65,
        w: 0.2,
        h: 0.4,
        fontFace: FONT_LATIN,
        fontSize: 16,
        bold: true,
        color: C.GOLD,
        align: 'center',
      });
    }
  });

  // 12-Column ERP Mapping Summary
  addCard(s, 0.6, 4.55, 12.133, 2.25);
  s.addText('ERP एक्सेल में समर्थित 3 इन्सेंटिव्ह स्लैब और बिक्री कॉलम (12-कॉलम फॉर्मेट)', {
    x: 0.85,
    y: 4.72,
    w: 11.6,
    h: 0.36,
    fontFace: FONT,
    fontSize: 13.5,
    bold: true,
    color: C.NAVY,
  });

  const slabs = [
    { name: 'स्लैब 1: New Items (नए उत्पाद)', detail: 'Sale Amt 1  ·  Sale Qty 1  ·  Incentive 1' },
    { name: 'स्लैब 2: Old Items (पुराने उत्पाद)', detail: 'Sale Amt 2  ·  Sale Qty 2  ·  Incentive 2' },
    { name: 'स्लैब 3: Other Items (अन्य उत्पाद)', detail: 'Sale Amt 3  ·  Sale Qty 3  ·  Incentive 3' },
  ];
  slabs.forEach((sl, idx) => {
    const x = 0.85 + idx * 3.92;
    addCard(s, x, 5.2, 3.7, 1.35, { fill: C.BG, border: C.BORDER });
    s.addText(sl.name, {
      x: x + 0.16,
      y: 5.36,
      w: 3.38,
      h: 0.38,
      fontFace: FONT,
      fontSize: 12,
      bold: true,
      color: C.NAVY,
    });
    s.addText(sl.detail, {
      x: x + 0.16,
      y: 5.82,
      w: 3.38,
      h: 0.42,
      fontFace: FONT_LATIN,
      fontSize: 11,
      color: C.SLATE,
    });
  });

  s.addNotes(
    'एडमिन स्टाफ को बताएं कि यदि एक्सेल में कोई खाली पंक्ति या Total Summary पंक्ति है तो सिस्टम उन्हें खुद छोड़ देता है। Error Report Excel डाउनलोड कर गलतियाँ ठीक की जा सकती हैं।',
  );
}

// ============================================================================
// SLIDE 7 — DUPLICATE PREVENTION & BUSINESS RULES
// ============================================================================
{
  const s = pptx.addSlide();
  addStandardChrome(
    s,
    7,
    TOTAL,
    'अध्याय 06 · महत्वपूर्ण व्यावसायिक नियम',
    'डुप्लीकेट रोकथाम और सटीक गणना के 6 अनिवार्य नियम',
    'गलत पेआउट और डबल-काउंटिंग से 100% सुरक्षा के लिए सिस्टम के कड़े नियम',
  );

  const rules = [
    {
      no: 'नियम 1',
      title: 'अद्वितीय पहचान कुंजी (Unique Key)',
      body: 'प्रत्येक रिकॉर्ड की पहचान Business Date + Salesman No (Employee ID) से होती है। हर दिन का इन्सेंटिव्ह स्वतंत्र रहता है।',
    },
    {
      no: 'नियम 2',
      title: 'दोबारा इम्पोर्ट पर जोड़ना प्रतिबंधित',
      body: 'एक ही तारीख और कर्मचारी का डेटा दोबारा आने पर सिस्टम नई राशि को पुरानी राशि में कभी नहीं जोड़ता (डिफ़ॉल्ट: SKIP)।',
    },
    {
      no: 'नियम 3',
      title: 'ओवरलैप प्रोटेक्शन (Daily vs Monthly)',
      body: 'यदि किसी कर्मचारी का Daily और Monthly या Custom Period आपस में टकराए, तो सिस्टम PERIOD_OVERLAP अलर्ट देता है।',
    },
    {
      no: 'नियम 4',
      title: 'सुधार (Correction) का पूरा ऑडिट',
      body: 'प्रकाशित रिकॉर्ड बदलने के लिए कारण लिखना अनिवार्य है। पुराना वर्ज़न Archive होता है और नया वर्ज़न नंबर बढ़ता है।',
    },
    {
      no: 'नियम 5',
      title: 'अप्रूवल से पहले गोपनीयता',
      body: 'जब तक सुपर एडमिन बैच को Approve & Publish न करे, कर्मचारी ऐप में कोई भी नया या संशोधित डेटा नहीं दिखता।',
    },
    {
      no: 'नियम 6',
      title: 'डबल काउंटिंग रहित मासिक योग',
      body: 'मासिक रिपोर्ट में Superseded रिकॉर्ड्स और Custom Period को कभी भी दो बार नहीं गिना जाता।',
    },
  ];

  rules.forEach((r, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const x = 0.6 + col * 6.18;
    const y = 1.5 + row * 1.78;
    addCard(s, x, y, 5.95, 1.58, { topBarColor: col === 0 ? C.NAVY : C.GOLD });
    s.addText(`${r.no}  ·  ${r.title}`, {
      x: x + 0.22,
      y: y + 0.2,
      w: 5.5,
      h: 0.36,
      fontFace: FONT,
      fontSize: 13.5,
      bold: true,
      color: C.NAVY,
    });
    s.addText(r.body, {
      x: x + 0.22,
      y: y + 0.62,
      w: 5.5,
      h: 0.84,
      fontFace: FONT,
      fontSize: 11.5,
      color: C.SLATE,
      lineSpacingMultiple: 1.38,
    });
  });

  s.addNotes(
    'ये 6 नियम हमारे पूरे सिस्टम की रीढ़ हैं। अकाउंट्स और एडमिन टीम को स्पष्ट समझाएं कि कोई भी गलती से डबल फाइल अपलोड करे तब भी कर्मचारी को डबल इन्सेंटिव्ह नहीं जाएगा।',
  );
}

// ============================================================================
// SLIDE 8 — EMPLOYEE & BRANCH MASTER MANAGEMENT
// ============================================================================
{
  const s = pptx.addSlide();
  addStandardChrome(
    s,
    8,
    TOTAL,
    'अध्याय 07 · कर्मचारी प्रबंधन',
    'एम्प्लॉई मास्टर: लॉगिन बनाना, स्टेटस नियंत्रण और ट्रांसफर नियम',
    'हर कर्मचारी की स्थायी पहचान उसका Salesman No है — नाम बदलने पर भी इतिहास सुरक्षित रहता है',
  );

  // Left card: Onboarding & Login Setup
  addCard(s, 0.6, 1.5, 5.9, 5.25, { topBarColor: C.NAVY });
  s.addText('नए कर्मचारी का सेटअप और लॉगिन', {
    x: 0.85,
    y: 1.72,
    w: 5.4,
    h: 0.4,
    fontFace: FONT,
    fontSize: 15.5,
    bold: true,
    color: C.NAVY,
  });
  s.addText(
    '1. ऑटो क्रिएशन / मैन्युअल एंट्री:\n' +
      '   एक्सेल अपलोड करते समय नए Salesman No वाले कर्मचारी अपने-आप जुड़ जाते हैं या आप Employees टैब से जोड़ सकते हैं।\n\n' +
      '2. डिफ़ॉल्ट पासवर्ड सुरक्षा:\n' +
      '   नए कर्मचारी का शुरुआती पासवर्ड  Muktai@123  होता है। पहली बार लॉगिन करते ही सिस्टम कर्मचारी से नया गुप्त पासवर्ड बनवाता है।\n\n' +
      '3. Salesman No ही मुख्य पहचान:\n' +
      '   यदि एक्सेल में नाम की स्पेलिंग थोड़ी अलग हो, तो भी सिस्टम Salesman No से उसी सही कर्मचारी को पहचानता है।\n\n' +
      '4. लॉगिन प्रोविज़निंग सिंक:\n' +
      '   एडमिन 1 क्लिक में किसी भी कर्मचारी का लॉगिन सक्रिय कर सकता है।',
    {
      x: 0.85,
      y: 2.22,
      w: 5.4,
      h: 4.3,
      fontFace: FONT,
      fontSize: 11.8,
      color: C.SLATE,
      lineSpacingMultiple: 1.38,
    },
  );

  // Right Top: Active / Inactive
  addCard(s, 6.83, 1.5, 5.9, 2.52, { topBarColor: C.EMERALD });
  s.addText('Active / Inactive नियंत्रण (केवल सुपर एडमिन)', {
    x: 7.08,
    y: 1.72,
    w: 5.4,
    h: 0.38,
    fontFace: FONT,
    fontSize: 14.5,
    bold: true,
    color: C.NAVY,
  });
  s.addText(
    '• कर्मचारी नौकरी छोड़ने पर उसे Delete नहीं किया जाता — बल्कि INACTIVE किया जाता है।\n' +
      '• INACTIVE करते ही कर्मचारी मोबाइल ऐप में लॉगिन नहीं कर सकता।\n' +
      '• उसका पूरा पुराना इन्सेंटिव्ह और पेआउट इतिहास ऑडिट के लिए हमेशा सुरक्षित रहता है।\n' +
      '• दोबारा काम पर आने पर ACTIVE करते ही पूरा इतिहास वापस दिखता है।',
    {
      x: 7.08,
      y: 2.18,
      w: 5.4,
      h: 1.72,
      fontFace: FONT,
      fontSize: 11.5,
      color: C.SLATE,
      lineSpacingMultiple: 1.36,
    },
  );

  // Right Bottom: Branch Transfer & SMPL Safety
  addCard(s, 6.83, 4.23, 5.9, 2.52, { fill: C.AMBER_BG, border: 'FDE68A', topBarColor: C.AMBER });
  s.addText('ब्रांच ट्रांसफर और SMPL सुरक्षा चेतावनी', {
    x: 7.08,
    y: 4.45,
    w: 5.4,
    h: 0.38,
    fontFace: FONT,
    fontSize: 14.5,
    bold: true,
    color: C.AMBER,
  });
  s.addText(
    '• Branch Transfer Alert: यदि कोई पुराना Salesman No नई शाखा के अंतर्गत एक्सेल में आए, तो सिस्टम चुपचाप शाखा नहीं बदलता बल्कि ट्रांसफर चेतावनी दिखाता है।\n' +
      '• SMPL Review Flag: SMPL पंक्तियाँ समीक्षा के लिए चिह्नित होती हैं और कभी भी अपने-आप Inactive नहीं होतीं।',
    {
      x: 7.08,
      y: 4.92,
      w: 5.4,
      h: 1.65,
      fontFace: FONT,
      fontSize: 11.5,
      color: C.INK,
      lineSpacingMultiple: 1.4,
    },
  );

  s.addNotes(
    'इस स्लाइड पर विशेष जोर दें कि कर्मचारी छोड़ने पर कभी डिलीट न करें — सिर्फ Inactive करें। इससे भविष्य के ऑडिट और अकाउंट्स मिलान में कोई डेटा नहीं खोता।',
  );
}

// ============================================================================
// SLIDE 9 — ANALYTICS & GROWTH TARGETS HUB
// ============================================================================
{
  const s = pptx.addSlide();
  addStandardChrome(
    s,
    9,
    TOTAL,
    'अध्याय 08 · एनालिटिक्स एवं सेल्स टार्गेट',
    'एनालिटिक्स और ग्रोथ टार्गेट: 6 स्मार्ट हब बटन',
    'बिना लंबा स्क्रोल किए 1 क्लिक में चार्ट्स, लीडरबोर्ड, शाखा दक्षता और टार्गेट प्रोग्रेस देखें',
  );

  const hubButtons = [
    { no: '01', name: 'Charts & Alerts', desc: '12 शाखा चार्ट, 6-माह ट्रेंड व ज़ीरो-सेल अलर्ट' },
    { no: '02', name: 'Top Performers', desc: 'टॉप परफॉर्मर्स लीडरबोर्ड और रैंकिंग' },
    { no: '03', name: 'Branch Efficiency', desc: '12 शाखाओं का Incentive-to-Sale % विवरण' },
    { no: '04', name: 'Growth Targets', desc: 'शाखा व कर्मचारी के मासिक ग्रोथ टार्गेट सेटअप' },
    { no: '05', name: 'Branch Progress', desc: 'प्रत्येक शाखा की लाइव टार्गेट प्रोग्रेस' },
    { no: '06', name: 'Employee Progress', desc: 'प्रत्येक कर्मचारी की व्यक्तिगत प्रोग्रेस व एडिट' },
  ];

  hubButtons.forEach((hb, idx) => {
    const col = idx % 3;
    const row = Math.floor(idx / 3);
    const x = 0.6 + col * 4.12;
    const y = 1.48 + row * 1.24;
    addCard(s, x, y, 3.88, 1.06, {
      fill: idx === 3 ? C.NAVY : C.WHITE,
      border: idx === 3 ? C.GOLD : C.BORDER,
    });
    s.addText(`${hb.no}  ${hb.name}`, {
      x: x + 0.18,
      y: y + 0.16,
      w: 3.52,
      h: 0.34,
      fontFace: FONT_LATIN,
      fontSize: 12.5,
      bold: true,
      color: idx === 3 ? C.GOLD_LIGHT : C.NAVY,
    });
    s.addText(hb.desc, {
      x: x + 0.18,
      y: y + 0.54,
      w: 3.52,
      h: 0.4,
      fontFace: FONT,
      fontSize: 10.8,
      color: idx === 3 ? 'E2E8F0' : C.SLATE,
    });
  });

  // Growth Target Concrete Formula Box
  addCard(s, 0.6, 4.18, 12.133, 2.6, { fill: C.GOLD_PALE, border: C.GOLD_BORDER });
  s.addText('ग्रोथ टार्गेट कैसे काम करता है? (व्यावहारिक उदाहरण)', {
    x: 0.88,
    y: 4.35,
    w: 11.5,
    h: 0.38,
    fontFace: FONT,
    fontSize: 15,
    bold: true,
    color: C.NAVY,
  });

  // Formula visual boxes
  addCard(s, 0.88, 4.86, 3.25, 1.12, { fill: C.WHITE, border: C.BORDER });
  s.addText('पिछले महीने की बिक्री', {
    x: 1.05,
    y: 4.98,
    w: 2.9,
    h: 0.3,
    fontFace: FONT,
    fontSize: 11,
    color: C.MUTED,
  });
  s.addText('₹ 1,00,000', {
    x: 1.05,
    y: 5.32,
    w: 2.9,
    h: 0.5,
    fontFace: FONT_LATIN,
    fontSize: 22,
    bold: true,
    color: C.NAVY,
  });

  s.addText('+', {
    x: 4.18,
    y: 5.18,
    w: 0.4,
    h: 0.5,
    fontFace: FONT_LATIN,
    fontSize: 24,
    bold: true,
    color: C.GOLD,
    align: 'center',
  });

  addCard(s, 4.63, 4.86, 2.85, 1.12, { fill: C.WHITE, border: C.GOLD });
  s.addText('ग्रोथ बढ़ोतरी (%)', {
    x: 4.8,
    y: 4.98,
    w: 2.5,
    h: 0.3,
    fontFace: FONT,
    fontSize: 11,
    color: C.MUTED,
  });
  s.addText('+10% ग्रोथ', {
    x: 4.8,
    y: 5.32,
    w: 2.5,
    h: 0.5,
    fontFace: FONT,
    fontSize: 21,
    bold: true,
    color: C.GOLD,
  });

  s.addText('=', {
    x: 7.53,
    y: 5.18,
    w: 0.4,
    h: 0.5,
    fontFace: FONT_LATIN,
    fontSize: 24,
    bold: true,
    color: C.NAVY,
    align: 'center',
  });

  addCard(s, 7.98, 4.86, 4.45, 1.12, { fill: C.NAVY, border: C.GOLD });
  s.addText('नया मासिक सेल्स टार्गेट (स्वचालित)', {
    x: 8.18,
    y: 4.98,
    w: 4.05,
    h: 0.3,
    fontFace: FONT,
    fontSize: 11,
    color: C.GOLD_LIGHT,
  });
  s.addText('₹ 1,10,000  (लाइव प्रोग्रेस बार)', {
    x: 8.18,
    y: 5.32,
    w: 4.05,
    h: 0.5,
    fontFace: FONT,
    fontSize: 19,
    bold: true,
    color: C.WHITE,
  });

  s.addText(
    '• यह टार्गेट 1 क्लिक में पूरी शाखा के सभी कर्मचारियों पर या किसी एक कर्मचारी पर लगाया जा सकता है — और तुरंत कर्मचारी के मोबाइल ऐप पर भी दिखता है।',
    {
      x: 0.88,
      y: 6.18,
      w: 11.55,
      h: 0.45,
      fontFace: FONT,
      fontSize: 11.5,
      bold: true,
      color: C.NAVY,
    },
  );

  s.addNotes(
    'Analytics & Targets में अब ऊपर 6 सुंदर बटन दिए गए हैं जिससे नीचे स्क्रोल करने की जरूरत नहीं पड़ती। Branch Progress में किसी शाखा पर क्लिक करते ही उस शाखा के कर्मचारी खुल जाते हैं।',
  );
}

// ============================================================================
// SLIDE 10 — PAYOUTS, ADJUSTMENTS & QUERIES
// ============================================================================
{
  const s = pptx.addSlide();
  addStandardChrome(
    s,
    10,
    TOTAL,
    'अध्याय 09 · अकाउंट्स एवं सहायता',
    'पेआउट प्रबंधन, एडजस्टमेंट और कर्मचारी क्वेरी समाधान',
    'अकाउंट्स द्वारा PAID मार्क करते ही कर्मचारी मोबाइल ऐप पर तुरंत भुगतान विवरण अपडेट होता है',
  );

  const cols = [
    {
      title: '1. पेआउट स्टेटस (Payouts)',
      bar: C.EMERALD,
      points:
        '• महीने और शाखा के अनुसार कर्मचारियों की नेट पेबल सूची देखें।\n\n' +
        '• एक साथ (Bulk) या एक-एक कर कर्मचारियों को PAID मार्क करें।\n\n' +
        '• पेमेंट मोड (Bank / UPI / Cash) और UTR / Reference नंबर दर्ज करें।\n\n' +
        '• मार्क होते ही कर्मचारी ऐप में "Pending" हटकर तुरंत "PAID" दिखता है।',
    },
    {
      title: '2. एडजस्टमेंट (Bonus / Deduction)',
      bar: C.GOLD,
      points:
        '• यदि किसी कर्मचारी को अतिरिक्त बोनस (+) देना हो या कटौती (-) करनी हो, तो Adjustments में दर्ज करें।\n\n' +
        '• कारण लिखना अनिवार्य है ताकि पूरी पारदर्शिता रहे।\n\n' +
        '• Net Payable = Gross Incentive + Bonus - Deduction अपने-आप गणना होती है।',
    },
    {
      title: '3. कर्मचारी क्वेरी (Queries)',
      bar: C.NAVY,
      points:
        '• यदि किसी कर्मचारी को अपने इन्सेंटिव्ह पर कोई प्रश्न है, तो वह मोबाइल ऐप से क्वेरी भेज सकता है।\n\n' +
        '• एडमिन को टॉप बार में तुरंत नोटिफिकेशन मिलता है।\n\n' +
        '• एडमिन जवाब लिखकर क्वेरी को RESOLVED मार्क करता है और कर्मचारी को ऐप में उत्तर दिखता है।',
    },
  ];

  cols.forEach((c, idx) => {
    const x = 0.6 + idx * 4.12;
    addCard(s, x, 1.5, 3.88, 4.25, { topBarColor: c.bar });
    s.addText(c.title, {
      x: x + 0.2,
      y: 1.72,
      w: 3.48,
      h: 0.42,
      fontFace: FONT,
      fontSize: 14,
      bold: true,
      color: C.NAVY,
    });
    s.addText(c.points, {
      x: x + 0.2,
      y: 2.24,
      w: 3.48,
      h: 3.3,
      fontFace: FONT,
      fontSize: 11.5,
      color: C.SLATE,
      lineSpacingMultiple: 1.38,
    });
  });

  addCard(s, 0.6, 5.95, 12.133, 0.88, { fill: C.EMERALD_BG, border: 'A7F3D0' });
  s.addText(
    'टिप: पुराने पेआउट रिकॉर्ड्स को कर्मचारी मोबाइल ऐप से सिंक करने के लिए Payouts टैब में "Sync to Staff App" बटन उपलब्ध है।',
    {
      x: 0.85,
      y: 6.18,
      w: 11.6,
      h: 0.42,
      fontFace: FONT,
      fontSize: 12,
      bold: true,
      color: C.EMERALD,
    },
  );

  s.addNotes(
    'अकाउंट्स टीम को बताएं कि हर महीने भुगतान के बाद Payouts & Queries टैब में जाकर कर्मचारियों को PAID मार्क करें ताकि उनके मोबाइल पर सही स्टेटस दिखे।',
  );
}

// ============================================================================
// SLIDE 11 — STAFF MOBILE APP: INSTALL & LOGIN
// ============================================================================
{
  const s = pptx.addSlide();
  addStandardChrome(
    s,
    11,
    TOTAL,
    'अध्याय 10 · कर्मचारी मोबाइल ऐप प्रशिक्षण (भाग 1)',
    'मोबाइल ऐप इंस्टॉल करना और पहली बार लॉगिन करने की विधि',
    'Android और iPhone दोनों पर बिना Play Store के सीधे इंस्टॉल करें (PWA टेक्नोलॉजी)',
  );

  // Left: 4 Step Guide
  addCard(s, 0.6, 1.5, 7.65, 5.28, { topBarColor: C.NAVY });
  s.addText('कर्मचारियों के लिए आसान 4-स्टेप गाइड', {
    x: 0.85,
    y: 1.72,
    w: 7.15,
    h: 0.4,
    fontFace: FONT,
    fontSize: 15.5,
    bold: true,
    color: C.NAVY,
  });

  const mobileSteps = [
    {
      n: '1',
      t: 'ऐप लिंक खोलें',
      d: 'अपने मोबाइल के Chrome ब्राउज़र में  https://staff.houseofmuktai.co.in  खोलें।',
    },
    {
      n: '2',
      t: 'होम स्क्रीन पर इंस्टॉल करें',
      d: '"Install App" बटन दबाएँ (या Chrome मेन्यू ⋮ → Add to Home Screen)। अब आइकन आपके फोन में ऐप की तरह दिखेगा।',
    },
    {
      n: '3',
      t: 'Salesman No और पासवर्ड डालें',
      d: 'अपना Employee ID (Salesman No) और एडमिन द्वारा दिया गया शुरुआती पासवर्ड (Muktai@123) दर्ज करें।',
    },
    {
      n: '4',
      t: 'अपना नया गुप्त पासवर्ड सेट करें',
      d: 'पहली बार लॉगिन पर सिस्टम नया पासवर्ड बनाने को कहेगा। अपना सुरक्षित पासवर्ड सेट करें और किसी से साझा न करें।',
    },
  ];

  mobileSteps.forEach((ms, idx) => {
    const y = 2.28 + idx * 1.08;
    s.addShape(pptx.ShapeType.ellipse, {
      x: 0.88,
      y: y + 0.06,
      w: 0.48,
      h: 0.48,
      fill: { color: C.NAVY },
      line: { color: C.GOLD, width: 1.5 },
    });
    s.addText(ms.n, {
      x: 0.88,
      y: y + 0.1,
      w: 0.48,
      h: 0.38,
      fontFace: FONT_LATIN,
      fontSize: 14,
      bold: true,
      color: C.GOLD_LIGHT,
      align: 'center',
    });
    s.addText(ms.t, {
      x: 1.52,
      y,
      w: 6.45,
      h: 0.34,
      fontFace: FONT,
      fontSize: 13.5,
      bold: true,
      color: C.NAVY,
    });
    s.addText(ms.d, {
      x: 1.52,
      y: y + 0.36,
      w: 6.45,
      h: 0.62,
      fontFace: FONT,
      fontSize: 11.2,
      color: C.SLATE,
      lineSpacingMultiple: 1.32,
    });
  });

  // Right: Phone Frame Visual Mockup
  addCard(s, 8.65, 1.5, 4.08, 5.28, {
    fill: C.NAVY,
    border: C.GOLD,
    borderWidth: 2,
    radius: 0.22,
  });
  // Speaker notch
  s.addShape(pptx.ShapeType.roundRect, {
    x: 10.15,
    y: 1.66,
    w: 1.1,
    h: 0.1,
    rectRadius: 0.05,
    fill: { color: C.NAVY_MID },
    line: { color: C.NAVY_MID, width: 0 },
  });

  addCard(s, 8.92, 1.92, 3.54, 4.55, { fill: C.BG, border: C.NAVY_MID, radius: 0.12 });
  // Mini header inside phone
  s.addShape(pptx.ShapeType.rect, {
    x: 8.92,
    y: 1.92,
    w: 3.54,
    h: 0.95,
    fill: { color: C.NAVY },
    line: { color: C.NAVY, width: 0 },
  });
  s.addText('नमस्ते, कर्मचारी नाम', {
    x: 9.1,
    y: 2.04,
    w: 3.18,
    h: 0.32,
    fontFace: FONT,
    fontSize: 12,
    bold: true,
    color: C.WHITE,
  });
  s.addText('ID: 459  ·  BARAMATI MIDC', {
    x: 9.1,
    y: 2.38,
    w: 3.18,
    h: 0.26,
    fontFace: FONT_LATIN,
    fontSize: 9.5,
    color: C.GOLD_LIGHT,
  });

  // Mini cards inside phone
  addCard(s, 9.1, 3.02, 3.18, 0.92, { fill: C.WHITE, border: C.GOLD_BORDER });
  s.addText('कुल प्रकाशित इन्सेंटिव्ह', {
    x: 9.25,
    y: 3.1,
    w: 2.88,
    h: 0.26,
    fontFace: FONT,
    fontSize: 9.5,
    color: C.MUTED,
  });
  s.addText('₹ 12,480.00', {
    x: 9.25,
    y: 3.38,
    w: 2.88,
    h: 0.42,
    fontFace: FONT_LATIN,
    fontSize: 18,
    bold: true,
    color: C.NAVY,
  });

  addCard(s, 9.1, 4.08, 3.18, 0.98, { fill: C.WHITE, border: C.BORDER });
  s.addText('मासिक टार्गेट प्रोग्रेस: 84%', {
    x: 9.25,
    y: 4.18,
    w: 2.88,
    h: 0.26,
    fontFace: FONT,
    fontSize: 10,
    bold: true,
    color: C.NAVY,
  });
  s.addShape(pptx.ShapeType.roundRect, {
    x: 9.25,
    y: 4.54,
    w: 2.88,
    h: 0.16,
    rectRadius: 0.08,
    fill: { color: C.BORDER },
    line: { color: C.BORDER, width: 0 },
  });
  s.addShape(pptx.ShapeType.roundRect, {
    x: 9.25,
    y: 4.54,
    w: 2.42,
    h: 0.16,
    rectRadius: 0.08,
    fill: { color: C.GOLD },
    line: { color: C.GOLD, width: 0 },
  });
  s.addText('लक्ष्य: ₹1,10,000  ·  बिक्री: ₹92,400', {
    x: 9.25,
    y: 4.74,
    w: 2.88,
    h: 0.24,
    fontFace: FONT,
    fontSize: 9,
    color: C.MUTED,
  });

  addCard(s, 9.1, 5.2, 3.18, 0.72, { fill: C.EMERALD_BG, border: 'A7F3D0' });
  s.addText('पेआउट स्टेटस: PAID ✓', {
    x: 9.25,
    y: 5.3,
    w: 2.88,
    h: 0.26,
    fontFace: FONT,
    fontSize: 10.5,
    bold: true,
    color: C.EMERALD,
  });
  s.addText('Bank Transfer · Ref: UTR849201', {
    x: 9.25,
    y: 5.58,
    w: 2.88,
    h: 0.24,
    fontFace: FONT_LATIN,
    fontSize: 9,
    color: C.SLATE,
  });

  s.addText('Home · Incentives · Reports · Profile · Settings', {
    x: 8.95,
    y: 6.1,
    w: 3.48,
    h: 0.28,
    fontFace: FONT_LATIN,
    fontSize: 8.2,
    bold: true,
    color: C.NAVY,
    align: 'center',
  });

  s.addNotes(
    'स्टाफ ट्रेनिंग के समय सभी कर्मचारियों के मोबाइल में staff.houseofmuktai.co.in खुलवाकर होम स्क्रीन पर इंस्टॉल करवाएं और उनका पहला लॉगिन पासवर्ड बदलवाएँ।',
  );
}

// ============================================================================
// SLIDE 12 — STAFF MOBILE APP: 5 BOTTOM TABS
// ============================================================================
{
  const s = pptx.addSlide();
  addStandardChrome(
    s,
    12,
    TOTAL,
    'अध्याय 11 · कर्मचारी मोबाइल ऐप प्रशिक्षण (भाग 2)',
    'कर्मचारी मोबाइल ऐप के 5 मुख्य सेक्शन (Bottom Navigation)',
    'हर कर्मचारी को मोबाइल के नीचे 5 सरल टैब मिलते हैं जिनसे पूरी जानकारी तुरंत मिलती है',
  );

  const tabs = [
    {
      no: '01',
      en: 'Home',
      hi: 'होम डैशबोर्ड',
      desc: '• कुल प्रकाशित इन्सेंटिव्ह\n• चालू माह व पिछला माह तुलना\n• लाइव सेल्स टार्गेट प्रोग्रेस\n• पेआउट स्टेटस (Paid/Pending)\n• हाल के प्रकाशित रिकॉर्ड्स',
      bar: C.NAVY,
    },
    {
      no: '02',
      en: 'My Incentives',
      hi: 'मेरे इन्सेंटिव्ह',
      desc: '• तारीख व महीने के अनुसार पूरी सूची\n• New / Old / Other स्लैब विवरण\n• Sale Amt और Sale Qty\n• एडजस्टमेंट (बोनस/कटौती)\n• केवल Approved डेटा',
      bar: C.GOLD,
    },
    {
      no: '03',
      en: 'Reports',
      hi: 'रिपोर्ट्स व चार्ट',
      desc: '• मासिक परफॉर्मेंस ग्राफ\n• वार्षिक इन्सेंटिव्ह सारांश\n• महीने के अनुसार फ़िल्टर\n• आधिकारिक PDF इन्सेंटिव्ह\n  स्टेटमेंट डाउनलोड',
      bar: C.EMERALD,
    },
    {
      no: '04',
      en: 'Profile',
      hi: 'प्रोफ़ाइल व क्वेरी',
      desc: '• नाम, Salesman No व शाखा\n• फ़ोन नंबर व पता अपडेट\n• नई क्वेरी (Query) भेजना\n• एडमिन का उत्तर और स्टेटस\n  (Open / Resolved) देखना',
      bar: C.NAVY_MID,
    },
    {
      no: '05',
      en: 'Settings',
      hi: 'सेटिंग्स व सुरक्षा',
      desc: '• पासवर्ड कभी भी बदलें\n• मोबाइल ऐप (PWA) इंस्टॉल\n• ऑफ़लाइन सपोर्ट जानकारी\n• सुरक्षित लॉगआउट\n  (Sign Out)',
      bar: C.SLATE,
    },
  ];

  tabs.forEach((t, idx) => {
    const x = 0.6 + idx * 2.47;
    addCard(s, x, 1.55, 2.3, 4.95, { topBarColor: t.bar });
    s.addText(t.no, {
      x: x + 0.16,
      y: 1.72,
      w: 1.98,
      h: 0.34,
      fontFace: FONT_LATIN,
      fontSize: 16,
      bold: true,
      color: C.GOLD,
    });
    s.addText(t.en, {
      x: x + 0.16,
      y: 2.08,
      w: 1.98,
      h: 0.34,
      fontFace: FONT_LATIN,
      fontSize: 13.5,
      bold: true,
      color: C.NAVY,
    });
    s.addText(t.hi, {
      x: x + 0.16,
      y: 2.42,
      w: 1.98,
      h: 0.36,
      fontFace: FONT,
      fontSize: 12.5,
      bold: true,
      color: C.NAVY_MID,
    });
    s.addShape(pptx.ShapeType.line, {
      x: x + 0.16,
      y: 2.86,
      w: 1.98,
      h: 0,
      line: { color: C.BORDER, width: 0.75 },
    });
    s.addText(t.desc, {
      x: x + 0.16,
      y: 3.0,
      w: 1.98,
      h: 3.3,
      fontFace: FONT,
      fontSize: 11,
      color: C.SLATE,
      lineSpacingMultiple: 1.45,
    });
  });

  s.addNotes(
    'कर्मचारियों को पांचों टैब का संक्षिप्त डेमो दिखाएं — विशेष रूप से Reports से PDF डाउनलोड करना और Profile टैब से क्वेरी भेजना।',
  );
}

// ============================================================================
// SLIDE 13 — SECURITY, AUDIT LOGS & BACKUP
// ============================================================================
{
  const s = pptx.addSlide();
  addStandardChrome(
    s,
    13,
    TOTAL,
    'अध्याय 12 · सुरक्षा एवं अनुपालन',
    'डेटा सुरक्षा, ऑडिट लॉग, रिपोर्ट्स और फुल बैकअप सिस्टम',
    'एंटरप्राइज स्तर की डेटा सुरक्षा ताकि कंपनी का वित्तीय रिकॉर्ड हमेशा सुरक्षित और विश्वसनीय रहे',
  );

  const secCards = [
    {
      title: '1. सख्त डेटाबेस सुरक्षा (Firestore Rules)',
      body: '• बिना लॉगिन के कोई भी डेटा एक्सेस नहीं किया जा सकता।\n• कर्मचारी केवल अपना uid / employeeId वाला प्रकाशित डेटा पढ़ सकता है।\n• Inactive कर्मचारी का एक्सेस तुरंत ब्लॉक हो जाता है।',
      bar: C.NAVY,
    },
    {
      title: '2. अनधिकृत डिलीट पर पूर्ण प्रतिबंध',
      body: '• किसी भी कर्मचारी का मास्टर रिकॉर्ड, पुराना इन्सेंटिव्ह वर्ज़न या ऑडिट लॉग कभी भी डिलीट नहीं किया जा सकता।\n• हर बदलाव का कारण और समय रिकॉर्ड होता है।',
      bar: C.ROSE,
    },
    {
      title: '3. संपूर्ण ऑडिट इतिहास (Audit Trail)',
      body: '• Approvals & Reports टैब में हर गतिविधि का लॉग मिलता है — किसने, कब और कौन सा बैच पब्लिश किया, किसे Active/Inactive किया या कौन सा सुधार किया।',
      bar: C.GOLD,
    },
    {
      title: '4. मैनेजमेंट रिपोर्ट्स और 1-क्लिक बैकअप',
      body: '• Management Excel Workbook (2 फॉर्मेटेड शीट्स) और PDF रिपोर्ट डाउनलोड।\n• पूरे डेटाबेस (सभी 15 कलेक्शन) का JSON बैकअप सुरक्षित रूप से डाउनलोड करने की सुविधा।',
      bar: C.EMERALD,
    },
  ];

  secCards.forEach((sc, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const x = 0.6 + col * 6.18;
    const y = 1.52 + row * 2.66;
    addCard(s, x, y, 5.95, 2.42, { topBarColor: sc.bar });
    s.addText(sc.title, {
      x: x + 0.24,
      y: y + 0.24,
      w: 5.47,
      h: 0.4,
      fontFace: FONT,
      fontSize: 14.5,
      bold: true,
      color: C.NAVY,
    });
    s.addText(sc.body, {
      x: x + 0.24,
      y: y + 0.74,
      w: 5.47,
      h: 1.5,
      fontFace: FONT,
      fontSize: 12,
      color: C.SLATE,
      lineSpacingMultiple: 1.42,
    });
  });

  s.addNotes(
    'मैनेजमेंट को आश्वस्त करें कि यह सिस्टम बैंक-ग्रेड एक्सेस रूल्स का पालन करता है और महीने में कम से कम एक बार Backup डाउनलोड कर सुरक्षित रखने की सलाह दें।',
  );
}

// ============================================================================
// SLIDE 14 — SOP CHECKLIST, FAQ & THANK YOU
// ============================================================================
{
  const s = pptx.addSlide();
  addStandardChrome(
    s,
    14,
    TOTAL,
    'अध्याय 13 · कार्यप्रणाली (SOP) एवं सामान्य प्रश्न',
    'मासिक संचालन चेकलिस्ट और सामान्य प्रश्न (FAQ)',
    'सुचारू संचालन के लिए एडमिन चेकलिस्ट और कर्मचारियों के सामान्य प्रश्नों के उत्तर',
  );

  // Left: Admin Monthly SOP Checklist
  addCard(s, 0.6, 1.48, 5.9, 4.18, { topBarColor: C.NAVY });
  s.addText('एडमिन के लिए मासिक / दैनिक चेकलिस्ट', {
    x: 0.85,
    y: 1.68,
    w: 5.4,
    h: 0.38,
    fontFace: FONT,
    fontSize: 14.5,
    bold: true,
    color: C.NAVY,
  });
  s.addText(
    '☑  1. ERP से सही तारीख की .xlsx फ़ाइल निकालकर अपलोड करें।\n\n' +
      '☑  2. वैलिडेशन स्क्रीन पर डुप्लीकेट, ओवरलैप व ट्रांसफर अलर्ट जांचें।\n\n' +
      '☑  3. समीक्षा के बाद बैच को Approve & Publish करें।\n\n' +
      '☑  4. महीने की शुरुआत में Analytics & Targets में ग्रोथ टार्गेट सेट करें।\n\n' +
      '☑  5. पेमेंट होने पर Payouts में PAID मार्क करें और Open Queries सुलझाएँ।\n\n' +
      '☑  6. महीने के अंत में Management Report व Backup डाउनलोड करें।',
    {
      x: 0.85,
      y: 2.16,
      w: 5.4,
      h: 3.35,
      fontFace: FONT,
      fontSize: 11.4,
      color: C.SLATE,
      lineSpacingMultiple: 1.32,
    },
  );

  // Right: Common FAQs
  addCard(s, 6.83, 1.48, 5.9, 4.18, { topBarColor: C.GOLD });
  s.addText('सामान्य प्रश्न और उत्तर (FAQ)', {
    x: 7.08,
    y: 1.68,
    w: 5.4,
    h: 0.38,
    fontFace: FONT,
    fontSize: 14.5,
    bold: true,
    color: C.NAVY,
  });
  s.addText(
    'प्र. 1: यदि कर्मचारी अपना पासवर्ड भूल जाए तो क्या करें?\n' +
      'उ.: एडमिन पैनल के Employees टैब से नया अस्थायी पासवर्ड रिसेट कर दें।\n\n' +
      'प्र. 2: एक्सेल अपलोड के बाद भी कर्मचारी को डेटा क्यों नहीं दिख रहा?\n' +
      'उ.: जांचें कि बैच Approve & Publish हो चुका है और कर्मचारी ACTIVE है।\n\n' +
      'प्र. 3: पेआउट हो गया है पर ऐप में Pending दिख रहा है?\n' +
      'उ.: Payouts टैब में PAID मार्क करें और "Sync to Staff App" बटन दबाएँ।\n\n' +
      'प्र. 4: कर्मचारी अपनी शिकायत कहाँ दर्ज करें?\n' +
      'उ.: मोबाइल ऐप के Profile → Queries सेक्शन में सीधे मैसेज भेजें।',
    {
      x: 7.08,
      y: 2.14,
      w: 5.4,
      h: 3.4,
      fontFace: FONT,
      fontSize: 11,
      color: C.SLATE,
      lineSpacingMultiple: 1.28,
    },
  );

  // Bottom Closing Banner
  addCard(s, 0.6, 5.86, 12.133, 1.0, { fill: C.NAVY, border: C.GOLD, borderWidth: 1.2 });
  s.addText('धन्यवाद!  ·  HOUSE OF MUKTAI — SHRIMUKTAI MART PRIVATE LIMITED', {
    x: 0.9,
    y: 5.98,
    w: 11.5,
    h: 0.38,
    fontFace: FONT,
    fontSize: 14.5,
    bold: true,
    color: C.GOLD_LIGHT,
    align: 'center',
  });
  s.addText('Admin Portal: houseofmuktai.co.in   |   Staff Mobile App: staff.houseofmuktai.co.in   |   Baramati, Pune', {
    x: 0.9,
    y: 6.38,
    w: 11.5,
    h: 0.34,
    fontFace: FONT_LATIN,
    fontSize: 11,
    color: 'CBD5E1',
    align: 'center',
  });

  s.addNotes(
    'प्रशिक्षण सत्र समाप्त करने से पहले एडमिन और कर्मचारियों के प्रश्न सुनें और एक लाइव टेस्ट लॉगिन तथा डमी एक्सेल प्रीव्यू दिखाकर सत्र का समापन करें। धन्यवाद!',
  );
}

await pptx.writeFile({ fileName: OUTPUT_PATH });
const stats = fs.statSync(OUTPUT_PATH);
console.log(`Generated Hindi Training PPT successfully: ${OUTPUT_PATH} (${(stats.size / 1024).toFixed(1)} KB)`);
