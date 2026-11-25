// Zabanen (English / Urdu / Arabic): URL ke prefix, hreflang aur title / description ka tarjuma.
// English bina prefix ke (/about), Urdu /ur/about, Arabic /ar/about. Frontend usi prefix se zaban chunta hai.

export const LANGS = ['en', 'ur', 'ar'] as const
export type Lang = (typeof LANGS)[number]

export const isLang = (value: unknown): value is Lang => LANGS.includes(value as Lang)
export const parseLang = (value: unknown): Lang => (isLang(value) ? value : 'en')

export const LANG_DIR: Record<Lang, 'ltr' | 'rtl'> = { en: 'ltr', ur: 'rtl', ar: 'rtl' }
export const LANG_LOCALE: Record<Lang, string> = { en: 'en_US', ur: 'ur_PK', ar: 'ar_AR' }

export const langPrefix = (lang: Lang) => (lang === 'en' ? '' : `/${lang}`)

// "/about" + ur -> "/ur/about"; home: "/" (en) ya "/ur"
export function localPath(lang: Lang, path: string) {
  if (path === '/' || path === '') return lang === 'en' ? '/' : `/${lang}`
  return `${langPrefix(lang)}${path}`
}

export interface Alternate {
  lang: string
  href: string
}

// hreflang: har zaban ka apna URL, aur x-default = English
export function alternatesFor(path: string, siteUrl: string): Alternate[] {
  return [
    ...LANGS.map((lang) => ({ lang, href: `${siteUrl}${localPath(lang, path)}` })),
    { lang: 'x-default', href: `${siteUrl}${localPath('en', path)}` },
  ]
}

type Text = Record<Lang, string>
const fill = (text: string, vars: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ''))

// Page titles / descriptions. {b} = brand, {n} = ginti, {c} = mulk, {p} = pesha / sanaat
const TEXT = {
  homeTitle: {
    en: '{b} | Hire Verified Creators, Speakers & Experts Worldwide',
    ur: '{b} | دنیا بھر کے تصدیق شدہ تخلیق کار، مقررین اور ماہرین کو ہائر کریں',
    ar: '{b} | وظّف صنّاع محتوى ومتحدثين وخبراء موثّقين حول العالم',
  },
  homeDesc: {
    en: 'Find and hire verified creators, journalists, speakers and experts worldwide. See their real reach, then connect or hire with signed digital agreements.',
    ur: 'دنیا بھر کے تصدیق شدہ تخلیق کار، صحافی، مقررین اور ماہرین تلاش کریں۔ ان کی اصل رسائی دیکھیں، پھر رابطہ کریں یا دستخط شدہ ڈیجیٹل معاہدے کے ساتھ ہائر کریں۔',
    ar: 'اعثر على صنّاع محتوى وصحفيين ومتحدثين وخبراء موثّقين حول العالم ووظّفهم. اطّلع على وصولهم الحقيقي ثم تواصل أو وظّف باتفاقيات رقمية موقّعة.',
  },
  aboutTitle: {
    en: 'About {b} | Verified Talent Marketplace',
    ur: '{b} کے بارے میں | تصدیق شدہ ٹیلنٹ مارکیٹ پلیس',
    ar: 'عن {b} | سوق المواهب الموثّقة',
  },
  aboutDesc: {
    en: '{b} is a marketplace where businesses find, check and hire creators, journalists, speakers and experts worldwide, with verified profiles, real reach and signed digital agreements.',
    ur: '{b} ایک مارکیٹ پلیس ہے جہاں کاروبار دنیا بھر کے تخلیق کاروں، صحافیوں، مقررین اور ماہرین کو تلاش، جانچ اور ہائر کرتے ہیں: تصدیق شدہ پروفائل، اصل رسائی اور دستخط شدہ ڈیجیٹل معاہدے۔',
    ar: '{b} سوق يجد فيه أصحاب الأعمال صنّاع محتوى وصحفيين ومتحدثين وخبراء حول العالم ويتحققون منهم ويوظّفونهم، مع ملفات موثّقة ووصول حقيقي واتفاقيات رقمية موقّعة.',
  },
  searchTitle: {
    en: 'Find Creators, Journalists, Speakers & Experts | {b}',
    ur: 'تخلیق کار، صحافی، مقررین اور ماہرین تلاش کریں | {b}',
    ar: 'ابحث عن صنّاع المحتوى والصحفيين والمتحدثين والخبراء | {b}',
  },
  searchDesc: {
    en: 'Search {n} public profiles of creators, journalists, speakers, experts and public figures worldwide. Compare real reach, then connect or hire.',
    ur: 'دنیا بھر کے تخلیق کاروں، صحافیوں، مقررین، ماہرین اور عوامی شخصیات کے {n} عوامی پروفائل تلاش کریں۔ اصل رسائی کا موازنہ کریں، پھر رابطہ کریں یا ہائر کریں۔',
    ar: 'ابحث في {n} ملفًا عامًا لصنّاع محتوى وصحفيين ومتحدثين وخبراء وشخصيات عامة حول العالم. قارن الوصول الحقيقي ثم تواصل أو وظّف.',
  },
  managersTitle: {
    en: 'Talent managers and agents | {b}',
    ur: 'ٹیلنٹ مینیجرز اور ایجنٹس | {b}',
    ar: 'مديرو المواهب والوكلاء | {b}',
  },
  managersDesc: {
    en: 'Verified managers and agents who represent creators, journalists, speakers and public figures on {b}.',
    ur: '{b} پر تخلیق کاروں، صحافیوں، مقررین اور عوامی شخصیات کی نمائندگی کرنے والے تصدیق شدہ مینیجرز اور ایجنٹس۔',
    ar: 'مديرون ووكلاء موثّقون يمثّلون صنّاع محتوى وصحفيين ومتحدثين وشخصيات عامة على {b}.',
  },
  businessesTitle: {
    en: 'Businesses and organizations | {b}',
    ur: 'کاروبار اور ادارے | {b}',
    ar: 'الشركات والمؤسسات | {b}',
  },
  businessesDesc: {
    en: 'Companies, brands, agencies and organizations hiring talent on {b}. See who is verified.',
    ur: '{b} پر ٹیلنٹ ہائر کرنے والی کمپنیاں، برانڈز، ایجنسیاں اور ادارے۔ دیکھیں کون تصدیق شدہ ہے۔',
    ar: 'شركات وعلامات تجارية ووكالات ومؤسسات توظّف مواهب على {b}. اعرف من هو موثّق.',
  },
  campaignsTitle: {
    en: 'Open Influencer & Talent Campaigns | {b}',
    ur: 'کھلی انفلوئنسر اور ٹیلنٹ مہمات | {b}',
    ar: 'حملات مفتوحة للمؤثرين والمواهب | {b}',
  },
  campaignsDesc: {
    en: 'Browse {n} open campaigns from verified businesses. Talent can apply with a short pitch.',
    ur: 'تصدیق شدہ کاروباروں کی {n} کھلی مہمات دیکھیں۔ ٹیلنٹ مختصر پچ کے ساتھ اپلائی کر سکتے ہیں۔',
    ar: 'تصفّح {n} حملة مفتوحة من شركات موثّقة. يمكن للمواهب التقديم بعرض قصير.',
  },
  talentIndexTitle: {
    en: 'Hire Talent by Profession, Industry & Country | {b}',
    ur: 'پیشہ، صنعت اور ملک کے لحاظ سے ٹیلنٹ ہائر کریں | {b}',
    ar: 'وظّف المواهب حسب المهنة والمجال والبلد | {b}',
  },
  talentIndexDesc: {
    en: 'Browse verified creators, journalists, speakers and experts by profession, industry and country, with real reach and rates, on {b}.',
    ur: '{b} پر پیشے، صنعت اور ملک کے لحاظ سے تصدیق شدہ تخلیق کار، صحافی، مقررین اور ماہرین دیکھیں، اصل رسائی اور ریٹس کے ساتھ۔',
    ar: 'تصفّح صنّاع محتوى وصحفيين ومتحدثين وخبراء موثّقين حسب المهنة والمجال والبلد، مع الوصول الحقيقي والأسعار على {b}.',
  },
  hubTitleCountry: {
    en: '{p} in {c} | Hire Verified Talent | {b}',
    ur: '{c} میں {p} | تصدیق شدہ ٹیلنٹ ہائر کریں | {b}',
    ar: '{p} في {c} | وظّف مواهب موثّقة | {b}',
  },
  hubTitleAll: {
    en: '{p} Talent Directory | Reach & Rates | {b}',
    ur: '{p} ٹیلنٹ ڈائریکٹری | رسائی اور ریٹس | {b}',
    ar: 'دليل مواهب {p} | الوصول والأسعار | {b}',
  },
  hubDescCountry: {
    en: 'Hire {p} talent in {c}: {n} public profiles with real reach, services and prices on {b}. Compare, then send a hire request.',
    ur: '{c} میں {p} ٹیلنٹ ہائر کریں: {b} پر اصل رسائی، سروسز اور قیمتوں کے ساتھ {n} عوامی پروفائل۔ موازنہ کریں، پھر ہائر ریکویسٹ بھیجیں۔',
    ar: 'وظّف مواهب {p} في {c}: {n} ملفًا عامًا بالوصول الحقيقي والخدمات والأسعار على {b}. قارن ثم أرسل طلب توظيف.',
  },
  hubDescAll: {
    en: 'Browse {n} {p} public profiles worldwide with real reach, services and prices on {b}. Compare, then send a hire request.',
    ur: '{b} پر اصل رسائی، سروسز اور قیمتوں کے ساتھ دنیا بھر کے {n} {p} عوامی پروفائل دیکھیں۔ موازنہ کریں، پھر ہائر ریکویسٹ بھیجیں۔',
    ar: 'تصفّح {n} ملفًا عامًا لـ{p} حول العالم بالوصول الحقيقي والخدمات والأسعار على {b}. قارن ثم أرسل طلب توظيف.',
  },
  profileReach: {
    en: 'Reach & Hire',
    ur: 'رسائی اور ہائر',
    ar: 'الوصول والتوظيف',
  },
  profileTail: {
    en: ' See reach, services and prices, then send a hire request.',
    ur: ' رسائی، سروسز اور قیمتیں دیکھیں، پھر ہائر ریکویسٹ بھیجیں۔',
    ar: ' اطّلع على الوصول والخدمات والأسعار ثم أرسل طلب توظيف.',
  },
  followersLine: {
    en: ' {n} followers',
    ur: ' {n} فالوورز',
    ar: ' {n} متابع',
  },
} satisfies Record<string, Text>

export type TextKey = keyof typeof TEXT

export function t(key: TextKey, lang: Lang, vars: Record<string, string | number> = {}) {
  return fill(TEXT[key][lang], vars)
}
