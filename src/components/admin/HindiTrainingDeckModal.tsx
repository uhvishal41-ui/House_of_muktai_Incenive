import React, { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  Presentation,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { COMPANY_BRAND } from '../../lib/companyBrand';

interface HindiTrainingSlide {
  slideNo: number;
  chapter: string;
  title: string;
  subtitle: string;
  points: string[];
  speakerNote: string;
}

const HINDI_TRAINING_SLIDES: HindiTrainingSlide[] = [
  {
    slideNo: 1,
    chapter: 'मुख्य पृष्ठ (Cover)',
    title: 'हाउस ऑफ मुक्ताई — कर्मचारी इन्सेंटिव्ह मैनेजमेंट सिस्टम',
    subtitle: 'संपूर्ण प्रशिक्षण प्रेज़ेंटेशन (हिंदी संस्करण) · 12 रिटेल शाखाएँ',
    points: [
      'कंपनी: SHRIMUKTAI MART PRIVATE LIMITED · बारामती, पुणे (महाराष्ट्र 413102)',
      'एडमिन वेब पोर्टल (सुपर एडमिन): https://houseofmuktai.co.in',
      'कर्मचारी मोबाइल ऐप (स्टाफ पोर्टल): https://staff.houseofmuktai.co.in',
      'इस प्रेज़ेंटेशन में एडमिन पैनल, एक्सेल अपलोड, ग्रोथ टार्गेट, पेआउट और स्टाफ मोबाइल ऐप का संपूर्ण प्रशिक्षण शामिल है।',
    ],
    speakerNote:
      'प्रशिक्षण सत्र की शुरुआत में सभी प्रतिभागियों का स्वागत करें और दोनों पोर्टल लिंक स्पष्ट बताएं।',
  },
  {
    slideNo: 2,
    chapter: 'अध्याय 01 · सिस्टम का परिचय',
    title: 'यह सिस्टम क्यों बनाया गया है और इसके मुख्य लाभ',
    subtitle: 'मैन्युअल एक्सेल की गलतियों को खत्म कर 12 शाखाओं के लिए एक आधुनिक डिजिटल प्रणाली',
    points: [
      '100% पारदर्शिता: हर कर्मचारी मोबाइल पर अपनी दैनिक व मासिक बिक्री, इन्सेंटिव्ह व पेआउट स्टेटस देख सकता है।',
      'शून्य डुप्लीकेट गारंटी: Business Date + Salesman No कुंजी से डबल एंट्री और गलत जोड़ पूरी तरह बंद।',
      '12 शाखाओं का एकीकृत नियंत्रण: सभी शाखाओं की तुलना, रैंकिंग और रिपोर्ट्स 1 क्लिक में।',
      'ग्रोथ टार्गेट ट्रैकिंग: पिछले महीने की बिक्री पर % बढ़ाकर स्मार्ट टार्गेट सेट करें और लाइव प्रोग्रेस देखें।',
    ],
    speakerNote:
      'मैन्युअल हिसाब बनाम डिजिटल सिस्टम का अंतर बताएं — समय की बचत और कर्मचारियों का भरोसा सबसे बड़ा लाभ है।',
  },
  {
    slideNo: 3,
    chapter: 'अध्याय 02 · रिटेल नेटवर्क',
    title: 'हाउस ऑफ मुक्ताई की 12 आधिकारिक शाखाएँ',
    subtitle: 'सभी 12 शाखाएँ ऑटो-सिंक और प्रमाणित हैं',
    points: [
      'बारामती एवं पुणे क्षेत्र: BARAMATI MIDC, BARAMATI MOTIBAGH, BHOSARI, INDAPUR, LONAND',
      'मराठवाड़ा एवं सोलापुर क्षेत्र: BEED, DHARASHIV, PANDHARPUR, PARANDA',
      'अहमदनगर क्षेत्र: RASHIN, SHRIGONDA, SUPA',
      'स्मार्ट ERP मैपिंग: यदि एक्सेल में "BARAMATI MOTIBAG" आए, तो सिस्टम उसे स्वतः "BARAMATI MOTIBAGH" से जोड़ता है।',
    ],
    speakerNote:
      'नई या डुप्लीकेट शाखा बनाने की जरूरत नहीं है; सभी 12 आधिकारिक शाखाएँ पहले से कॉन्फ़िगर हैं।',
  },
  {
    slideNo: 4,
    chapter: 'अध्याय 03 · पोर्टल संरचना एवं गोपनीयता',
    title: 'दो अलग पोर्टल और सख्त डेटा सुरक्षा नियम (RBAC)',
    subtitle: 'एडमिन और कर्मचारियों के लिए अलग डोमेन, लॉगिन और अधिकार',
    points: [
      'एडमिन पैनल (houseofmuktai.co.in): केवल सुपर एडमिन (Google Sign-In) — अपलोड, अप्रूवल, टार्गेट, पेआउट व बैकअप।',
      'कर्मचारी मोबाइल ऐप (staff.houseofmuktai.co.in): Salesman No + पासवर्ड — केवल स्वयं का प्रकाशित डेटा।',
      'डेटा गोपनीयता लॉक: Firestore Security Rules सुनिश्चित करते हैं कि एक कर्मचारी दूसरे का डेटा कभी नहीं देख सकता।',
      'बिना एडमिन अप्रूवल के कोई भी नया या संशोधित डेटा कर्मचारी ऐप में दिखाई नहीं देता।',
    ],
    speakerNote:
      'स्टाफ को स्पष्ट बताएं कि उनका डेटा पूरी तरह निजी है और केवल वे स्वयं व सुपर एडमिन ही उसे देख सकते हैं।',
  },
  {
    slideNo: 5,
    chapter: 'अध्याय 04 · एडमिन पैनल',
    title: 'एडमिन डैशबोर्ड: 4 मुख्य KPI कार्ड्स और क्विक टूल्स',
    subtitle: 'महीने की पूरी वित्तीय और बिक्री स्थिति एक नज़र में',
    points: [
      '4 अलग एनिमेटेड KPI कार्ड्स: Published Incentive, Total Sale Amount (₹), Total Sale Qty (Units), और Incentive Ratio (%)।',
      'क्विक-एक्शन स्ट्रिप: All-Time Incentive, Active Employees, Retail Branches, Pending Batches और Open Queries पर 1-क्लिक जंप।',
      'Global Search (Ctrl + K): किसी भी कर्मचारी, शाखा या बैच को तुरंत खोजें।',
      'Staff App Link कॉपी बटन: 1 क्लिक में कर्मचारी ऐप लिंक कॉपी कर WhatsApp ग्रुप में साझा करें।',
    ],
    speakerNote:
      'लाइव डैशबोर्ड खोलकर चारों अलग KPI कार्ड्स और मंथ फ़िल्टर का डेमो दिखाएं।',
  },
  {
    slideNo: 6,
    chapter: 'अध्याय 05 · डेटा अपलोड प्रक्रिया',
    title: 'ERP एक्सेल अपलोड और पब्लिश वर्कफ़्लो (5 चरण)',
    subtitle: '12-कॉलम ERP फॉर्मेट (.xlsx) के साथ स्वचालित जाँच',
    points: [
      'चरण 1 व 2: .xlsx फ़ाइल चुनें — सिस्टम बैनर से तारीख पढ़कर Daily, Monthly या Custom Period स्वतः पहचानता है।',
      'चरण 3: 3 स्लैब (New Items, Old Items, Other Items) की Sale Amt, Sale Qty और Incentive राशि वैलिडेट होती है।',
      'चरण 4: डुप्लीकेट, ओवरलैप, ब्रांच ट्रांसफर या SMPL पंक्तियों की समीक्षा करें (Skip / Correct चुनें)।',
      'चरण 5: Approve & Publish क्लिक करते ही डेटा सुरक्षित सेव होकर कर्मचारी मोबाइल ऐप पर लाइव दिखता है।',
    ],
    speakerNote:
      'एक्सेल की खाली या Total Summary पंक्तियाँ सिस्टम स्वतः छोड़ देता है; त्रुटि होने पर Error Report Excel डाउनलोड की जा सकती है।',
  },
  {
    slideNo: 7,
    chapter: 'अध्याय 06 · व्यावसायिक नियम',
    title: 'डुप्लीकेट रोकथाम और सटीक गणना के 6 अनिवार्य नियम',
    subtitle: 'गलत पेआउट और डबल-काउंटिंग से 100% सुरक्षा',
    points: [
      'Unique Key: Business Date + Salesman No — हर दिन की इन्सेंटिव्ह राशि स्वतंत्र रहती है।',
      'दोबारा इम्पोर्ट सुरक्षा: एक ही तारीख का डेटा दोबारा आने पर राशि कभी जुड़ती नहीं (डिफ़ॉल्ट: SKIP)।',
      'Overlap अलर्ट: Daily, Monthly या Custom Period टकराने पर सिस्टम PERIOD_OVERLAP चेतावनी देता है।',
      'Audited Correction: प्रकाशित रिकॉर्ड में सुधार के लिए कारण लिखना अनिवार्य है और पुराना वर्ज़न Archive रहता है।',
    ],
    speakerNote:
      'अकाउंट्स टीम को आश्वस्त करें कि गलती से एक ही फाइल दो बार अपलोड होने पर भी डबल पेमेंट नहीं बनेगा।',
  },
  {
    slideNo: 8,
    chapter: 'अध्याय 07 · कर्मचारी प्रबंधन',
    title: 'एम्प्लॉई मास्टर: लॉगिन, Active/Inactive व ट्रांसफर नियम',
    subtitle: 'Salesman No ही कर्मचारी की स्थायी डिजिटल पहचान है',
    points: [
      'डिफ़ॉल्ट पासवर्ड: नए कर्मचारी का शुरुआती पासवर्ड Muktai@123 होता है (प्रथम लॉगिन पर बदलना अनिवार्य)।',
      'नाम स्पेलिंग सुरक्षा: एक्सेल में नाम की स्पेलिंग बदल जाए तो भी Salesman No से सही कर्मचारी मैच होता है।',
      'Active / Inactive नियंत्रण: कर्मचारी छोड़ने पर Delete नहीं बल्कि INACTIVE करें — लॉगिन बंद होगा पर इतिहास सुरक्षित रहेगा।',
      'Branch Transfer & SMPL Alert: शाखा बदलने पर सिस्टम चुपचाप ओवरराइट नहीं करता बल्कि एडमिन से पुष्टि मांगता है।',
    ],
    speakerNote:
      'कभी भी किसी कर्मचारी को डिलीट करने की कोशिश न करें — केवल सुपर एडमिन स्टेटस को Inactive कर सकता है।',
  },
  {
    slideNo: 9,
    chapter: 'अध्याय 08 · एनालिटिक्स एवं ग्रोथ टार्गेट',
    title: 'एनालिटिक्स और ग्रोथ टार्गेट: 6 स्मार्ट हब बटन',
    subtitle: 'बिना लंबा स्क्रोल किए 1 क्लिक में हर रिपोर्ट व टार्गेट प्रोग्रेस',
    points: [
      '6 स्मार्ट हब बटन: Charts & Alerts · Top Performers · Branch Efficiency · Growth Targets · Branch Progress · Employee Progress।',
      'ग्रोथ टार्गेट उदाहरण: पिछले महीने बिक्री ₹1,00,000 + 10% ग्रोथ = ₹1,10,000 नया मासिक टार्गेट स्वतः सेट।',
      'दोनों तरफ लाइव प्रोग्रेस: एडमिन पैनल और कर्मचारी मोबाइल ऐप — दोनों पर रियल-टाइम टार्गेट प्रोग्रेस बार दिखता है।',
      'स्मार्ट जंप: Branch Progress में शाखा पर क्लिक कर सीधे उस शाखा के कर्मचारियों की प्रोग्रेस देखें।',
    ],
    speakerNote:
      'महीने की शुरुआत में Growth Targets से सभी 12 शाखाओं के कर्मचारियों के टार्गेट 1 क्लिक में सेट करने का डेमो दें।',
  },
  {
    slideNo: 10,
    chapter: 'अध्याय 09 · अकाउंट्स एवं सहायता',
    title: 'पेआउट प्रबंधन, एडजस्टमेंट और कर्मचारी क्वेरी समाधान',
    subtitle: 'भुगतान स्टेटस और शंका समाधान का रियल-टाइम सिंक',
    points: [
      'पेआउट स्टेटस: एक साथ (Bulk) या व्यक्तिगत रूप से PAID मार्क करें (Bank / UPI / Cash + Reference नंबर)।',
      'एडजस्टमेंट: अतिरिक्त बोनस (+) या कटौती (-) कारण सहित दर्ज करें — Net Payable स्वतः अपडेट होता है।',
      'कर्मचारी क्वेरी: स्टाफ ऐप से आई क्वेरी का उत्तर देकर RESOLVED मार्क करें — तुरंत स्टाफ को उत्तर दिखता है।',
      'Sync to Staff App बटन: पुराने पेआउट रिकॉर्ड्स को 1 क्लिक में कर्मचारी मोबाइल ऐप से सिंक करें।',
    ],
    speakerNote:
      'हर महीने पेआउट वितरण के तुरंत बाद Payouts टैब अपडेट करें ताकि स्टाफ को Pending की जगह PAID स्टेटस दिखे।',
  },
  {
    slideNo: 11,
    chapter: 'अध्याय 10 · कर्मचारी मोबाइल ऐप (भाग 1)',
    title: 'मोबाइल ऐप इंस्टॉल करना और पहला लॉगिन',
    subtitle: 'Android व iPhone पर बिना Play Store के सीधे PWA इंस्टॉल',
    points: [
      'स्टेप 1: मोबाइल के Chrome में https://staff.houseofmuktai.co.in खोलें।',
      'स्टेप 2: "Install App" (या Chrome ⋮ → Add to Home Screen) दबाकर होम स्क्रीन पर ऐप जोड़ें।',
      'स्टेप 3: अपना Salesman No (Employee ID) और शुरुआती पासवर्ड Muktai@123 डालकर लॉगिन करें।',
      'स्टेप 4: पहली बार लॉगिन पर अपना नया गुप्त पासवर्ड सेट करें और किसी के साथ साझा न करें।',
    ],
    speakerNote:
      'ट्रेनिंग हॉल में ही सभी कर्मचारियों के फोन में ऐप इंस्टॉल करवाकर पहला लॉगिन पूरा करवाएं।',
  },
  {
    slideNo: 12,
    chapter: 'अध्याय 11 · कर्मचारी मोबाइल ऐप (भाग 2)',
    title: 'कर्मचारी मोबाइल ऐप के 5 मुख्य टैब (Bottom Navigation)',
    subtitle: 'सरल, तेज़ और मोबाइल-फर्स्ट इंटरफ़ेस',
    points: [
      'Home: कुल प्रकाशित इन्सेंटिव्ह, चालू व पिछला महीना, लाइव टार्गेट प्रोग्रेस और पेआउट स्टेटस।',
      'My Incentives: दैनिक/मासिक पूरा विवरण, 3 स्लैब ब्रेकडाउन (New/Old/Other) और एडजस्टमेंट।',
      'Reports: मासिक परफॉर्मेंस चार्ट, वार्षिक सारांश और आधिकारिक PDF स्टेटमेंट डाउनलोड।',
      'Profile व Settings: व्यक्तिगत विवरण, नई क्वेरी भेजना, पासवर्ड बदलना और सुरक्षित लॉगआउट।',
    ],
    speakerNote:
      'कर्मचारियों को PDF डाउनलोड करना और किसी अंतर की स्थिति में Profile → Queries से मैसेज भेजना सिखाएं।',
  },
  {
    slideNo: 13,
    chapter: 'अध्याय 12 · सुरक्षा एवं अनुपालन',
    title: 'डेटा सुरक्षा, ऑडिट लॉग, रिपोर्ट्स और फुल बैकअप',
    subtitle: 'कंपनी के वित्तीय डेटा की एंटरप्राइज स्तर की सुरक्षा',
    points: [
      'Firestore Security Rules: बिना प्रमाणीकरण कोई एक्सेस नहीं; Inactive कर्मचारी का लॉगिन तुरंत बंद।',
      'Zero Unauthorized Delete: कर्मचारी मास्टर, पुराने इन्सेंटिव्ह वर्ज़न और ऑडिट लॉग कभी डिलीट नहीं होते।',
      'संपूर्ण Audit Trail: हर पब्लिश, सुधार, स्टेटस बदलाव और पेआउट का समय व कर्ता रिकॉर्ड रहता है।',
      'रिपोर्ट व बैकअप: Management Excel Workbook, PDF रिपोर्ट और सभी 15 कलेक्शन का JSON बैकअप उपलब्ध।',
    ],
    speakerNote:
      'महीने में कम से कम एक बार Approvals & Reports से Full Database Backup डाउनलोड कर सुरक्षित रखें।',
  },
  {
    slideNo: 14,
    chapter: 'अध्याय 13 · SOP एवं सामान्य प्रश्न',
    title: 'मासिक संचालन चेकलिस्ट और सामान्य प्रश्न (FAQ)',
    subtitle: 'सुचारू संचालन के लिए दैनिक नियम और त्वरित समाधान',
    points: [
      'एडमिन चेकलिस्ट: ERP .xlsx अपलोड → वैलिडेशन समीक्षा → Approve & Publish → ग्रोथ टार्गेट → PAID मार्क → बैकअप।',
      'पासवर्ड भूलने पर: एडमिन पैनल के Employees टैब से नया अस्थायी पासवर्ड रिसेट किया जा सकता है।',
      'डेटा न दिखने पर: जांचें कि बैच Published हो गया है और कर्मचारी का स्टेटस ACTIVE है।',
      'धन्यवाद! · HOUSE OF MUKTAI (SHRIMUKTAI MART PRIVATE LIMITED) · बारामती, पुणे।',
    ],
    speakerNote:
      'सत्र के अंत में प्रश्नोत्तर (Q&A) रखें और लाइव सिस्टम पर एक त्वरित डेमो दिखाकर प्रशिक्षण समाप्त करें।',
  },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export function HindiTrainingDeckModal({ open, onClose }: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const currentSlide = HINDI_TRAINING_SLIDES[activeIndex];

  const handleDownloadPptx = async () => {
    setDownloading(true);
    setDownloadError(null);
    try {
      const response = await fetch('/House_of_Muktai_Training_Hindi.pptx');
      if (!response.ok) {
        throw new Error('PPT file could not be fetched. Please refresh and try again.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'House_of_Muktai_Training_Hindi.pptx';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      setDownloadError(
        err instanceof Error ? err.message : 'Unable to download PowerPoint file right now.',
      );
    } finally {
      setDownloading(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="hindi-ppt-modal-title"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={onClose}
            className="fixed inset-0 bg-[#0F1F3D]/60 backdrop-blur-xs"
          />

          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 w-full max-w-5xl max-h-[90vh] bg-white rounded-2xl border border-slate-200 shadow-2xl flex flex-col overflow-hidden"
          >
            {/* Top Gold Hairline */}
            <div className="h-1 w-full bg-gradient-to-r from-[#B8923A] via-[#DFC27D] to-[#B8923A]" />

            {/* Modal Header */}
            <div className="px-5 py-4 bg-[#0F1F3D] text-white flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-[#1E3A5F] border border-[#B8923A]/50 flex items-center justify-center shrink-0">
                  <Presentation className="w-4.5 h-4.5 text-[#DFC27D]" />
                </div>
                <div className="min-w-0">
                  <h2 id="hindi-ppt-modal-title" className="text-base font-bold text-white truncate">
                    हिंदी प्रशिक्षण प्रेज़ेंटेशन (Hindi Training PPT)
                  </h2>
                  <p className="text-xs text-slate-300 truncate">
                    {COMPANY_BRAND.brandNameUpper} · 14 Slides · PowerPoint (.pptx) + Trainer Notes
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleDownloadPptx}
                  disabled={downloading}
                  className="h-9 px-4 rounded-xl bg-[#B8923A] hover:bg-[#A6802C] text-[#0F1F3D] font-bold text-xs inline-flex items-center gap-2 cursor-pointer transition-colors disabled:opacity-70 whitespace-nowrap"
                >
                  {downloading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  <span>{downloading ? 'Downloading...' : 'Download PPT (.pptx)'}</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close training deck modal"
                  className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-slate-200 flex items-center justify-center cursor-pointer transition-colors"
                >
                  <X className="w-4.5 h-4.5" />
                </button>
              </div>
            </div>

            {downloadError && (
              <div className="px-5 py-2.5 bg-rose-50 border-b border-rose-200 text-xs text-rose-800">
                {downloadError}
              </div>
            )}

            {/* Modal Body: Slide Outline + Interactive Slide Preview */}
            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
              {/* Left Slide Index (Desktop) */}
              <aside className="hidden lg:block lg:col-span-4 border-r border-slate-200 bg-[#F8FAFC] overflow-y-auto p-3 space-y-1">
                {HINDI_TRAINING_SLIDES.map((s, idx) => {
                  const active = idx === activeIndex;
                  return (
                    <button
                      key={s.slideNo}
                      type="button"
                      onClick={() => setActiveIndex(idx)}
                      className={`w-full text-left px-3 py-2.5 rounded-xl border transition-colors cursor-pointer ${
                        active
                          ? 'bg-[#0F1F3D] text-white border-[#0F1F3D]'
                          : 'bg-white text-slate-700 border-slate-200/80 hover:border-[#B8923A]/60'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className={active ? 'text-[#DFC27D] font-semibold' : 'text-slate-400'}>
                          {s.chapter}
                        </span>
                        <span
                          className={`font-mono tabular-nums font-bold ${
                            active ? 'text-white' : 'text-slate-400'
                          }`}
                        >
                          {String(s.slideNo).padStart(2, '0')}
                        </span>
                      </div>
                      <p
                        className={`text-xs font-semibold mt-0.5 line-clamp-1 ${
                          active ? 'text-white' : 'text-[#0F1F3D]'
                        }`}
                      >
                        {s.title}
                      </p>
                    </button>
                  );
                })}
              </aside>

              {/* Right Active Slide Stage */}
              <div className="lg:col-span-8 flex flex-col min-h-0 overflow-y-auto p-4 sm:p-6 bg-[#F5F7FA]">
                {/* Simulated 16:9 Slide Card */}
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
                  <div className="h-1 bg-[#B8923A]" />
                  <div className="px-5 py-4 bg-[#0F1F3D] text-white">
                    <div className="flex items-center justify-between gap-2 text-[11px] text-[#DFC27D] font-semibold">
                      <span>{currentSlide.chapter}</span>
                      <span className="font-mono tabular-nums">
                        स्लाइड {currentSlide.slideNo} / {HINDI_TRAINING_SLIDES.length}
                      </span>
                    </div>
                    <h3 className="text-lg sm:text-xl font-bold text-white mt-1 leading-snug">
                      {currentSlide.title}
                    </h3>
                    <p className="text-xs text-slate-300 mt-1">{currentSlide.subtitle}</p>
                  </div>

                  <div className="p-5 sm:p-6 space-y-3">
                    {currentSlide.points.map((point, idx) => (
                      <div
                        key={idx}
                        className="flex items-start gap-3 p-3 rounded-xl bg-[#F8FAFC] border border-slate-200/80"
                      >
                        <span className="w-6 h-6 rounded-lg bg-[#0F1F3D] text-[#DFC27D] font-mono tabular-nums text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                          {idx + 1}
                        </span>
                        <p className="text-sm text-slate-800 leading-relaxed">{point}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Trainer Speaker Notes */}
                <div className="mt-4 p-4 rounded-xl bg-[#FBF6EA] border border-[#E8D7AE]">
                  <div className="flex items-center gap-2 text-xs font-bold text-[#0F1F3D]">
                    <FileText className="w-3.5 h-3.5 text-[#B8923A]" />
                    <span>ट्रेनर नोट्स (Speaker Note — PPT में शामिल)</span>
                  </div>
                  <p className="text-xs text-slate-700 mt-1.5 leading-relaxed">
                    {currentSlide.speakerNote}
                  </p>
                </div>

                {/* Slide Controls */}
                <div className="mt-4 pt-3 border-t border-slate-200 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setActiveIndex((prev) => Math.max(0, prev - 1))}
                    disabled={activeIndex === 0}
                    className="h-9 px-3.5 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-[#0F1F3D] inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-45"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span>पिछली स्लाइड</span>
                  </button>

                  <span className="text-xs font-mono tabular-nums font-semibold text-slate-600">
                    {currentSlide.slideNo} / {HINDI_TRAINING_SLIDES.length}
                  </span>

                  <button
                    type="button"
                    onClick={() =>
                      setActiveIndex((prev) => Math.min(HINDI_TRAINING_SLIDES.length - 1, prev + 1))
                    }
                    disabled={activeIndex === HINDI_TRAINING_SLIDES.length - 1}
                    className="h-9 px-3.5 rounded-xl bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-45"
                  >
                    <span>अगली स्लाइड</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
