export const COMPANY_BRAND = {
  brandName: 'House of Muktai',
  brandNameUpper: 'HOUSE OF MUKTAI',
  legalName: 'SHRIMUKTAI MART PRIVATE LIMITED',
  addressLine1: 'First Floor, WAGHOLIKAR HOUSE, Wagholikar Sanitation, BHIGWAN ROAD',
  addressLine2: 'Baramati, Pune, Maharashtra - 413102',
  fullAddress:
    'First Floor, WAGHOLIKAR HOUSE, Wagholikar Sanitation, BHIGWAN ROAD, Baramati, Pune, Maharashtra - 413102',
  logoWebpPath: '/assets/aistudio/House_of_Muktai_Logo_4446bc99.webp',
  logoPngPath: '/assets/aistudio/house-of-muktai-logo.png',
  branchCountLabel: '12 Retail Branches',
  portalDomain: 'houseofmuktai.co.in',
  staffDomain: 'staff.houseofmuktai.co.in',
} as const;

export const DEFAULT_EMPLOYEE_PASSWORD = 'Muktai@123';

/**
 * Returns the shareable Employee Mobile App URL.
 * - On live production domain (`houseofmuktai.co.in` / `www.houseofmuktai.co.in`), returns `https://staff.houseofmuktai.co.in`.
 * - In AI Studio preview, converts private `ais-dev-*` URLs (which return 403 on other devices) into `ais-pre-*`.
 */
export function getShareableStaffAppUrl(): string {
  if (typeof window === 'undefined') {
    return `https://${COMPANY_BRAND.staffDomain}`;
  }
  const host = window.location.hostname.toLowerCase();
  if (
    host === COMPANY_BRAND.portalDomain ||
    host === `www.${COMPANY_BRAND.portalDomain}` ||
    host === `admin.${COMPANY_BRAND.portalDomain}` ||
    host === COMPANY_BRAND.staffDomain
  ) {
    return `https://${COMPANY_BRAND.staffDomain}`;
  }
  const origin = window.location.origin.replace(/^https:\/\/ais-dev-/, 'https://ais-pre-');
  return `${origin}/?portal=staff`;
}
