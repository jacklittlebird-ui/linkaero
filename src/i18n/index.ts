import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "./locales/en.json";
import ar from "./locales/ar.json";

export const LANG_STORAGE_KEY = "linkaero.lang";

if (!i18n.isInitialized) {
  i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources: { en: { translation: en }, ar: { translation: ar } },
      fallbackLng: "en",
      supportedLngs: ["en", "ar"],
      interpolation: { escapeValue: false },
      detection: {
        order: ["localStorage", "navigator"],
        lookupLocalStorage: LANG_STORAGE_KEY,
        caches: ["localStorage"],
      },
    });
}

const applyDir = (lng: string) => {
  const dir = lng === "ar" ? "rtl" : "ltr";
  document.documentElement.dir = dir;
  document.documentElement.lang = lng;
};

applyDir(i18n.language || "en");
i18n.on("languageChanged", applyDir);

// Accounts whose portal opens in Arabic (RTL) by default unless the user picked a language themselves.
export const ARABIC_DEFAULT_ACCOUNTS = ["acceng@linkagency.com", "accpay@linkagency.com"];
const chosenKey = (email: string) => `linkaero.lang.chosen.${email.toLowerCase()}`;

export function applyAccountDefaultLanguage(email?: string | null) {
  if (!email || !ARABIC_DEFAULT_ACCOUNTS.includes(email.toLowerCase())) return;
  if (localStorage.getItem(chosenKey(email))) return;
  if (i18n.language !== "ar") i18n.changeLanguage("ar");
}

export function rememberLanguageChoice(email?: string | null) {
  if (email) localStorage.setItem(chosenKey(email), "1");
}

export default i18n;
