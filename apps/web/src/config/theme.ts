/**
 * Theme storage key and the pre-hydration boot script.
 *
 * Kept free of 'use client' so the root layout (a server component) can inline
 * the script string; the provider in state/theme.tsx imports the same key.
 */
export const THEME_KEY = 'arkswap.theme';

/** Runs before hydration so the stored theme is applied on the very first paint. */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');if(t==='light'){document.documentElement.setAttribute('data-theme','light')}}catch(e){}})();`;
