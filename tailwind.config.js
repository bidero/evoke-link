/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class', // dark mode przełączany klasą .dark na <html> (ręcznie, ikoną)
  // Tailwind skanuje te pliki w poszukiwaniu użytych klas i generuje tylko potrzebny CSS.
  content: [
    './src/views/**/*.ejs',
    './src/assets/js/**/*.js',
    './src/utils/**/*.js',
  ],
  theme: {
    extend: {
      colors: {
        // Kolor przewodni Evoke (logo): #6e00a5 = brand-600.
        // Paleta oparta na zmiennych CSS (--brand-*), żeby kolor dało się zmienić
        // w panelu BEZ przebudowy CSS. Wartości domyślne są w src/assets/css/input.css,
        // a strona klienta nadpisuje je z ustawień (utils/color.js).
        brand: {
          50: 'rgb(var(--brand-50) / <alpha-value>)',
          100: 'rgb(var(--brand-100) / <alpha-value>)',
          200: 'rgb(var(--brand-200) / <alpha-value>)',
          300: 'rgb(var(--brand-300) / <alpha-value>)',
          400: 'rgb(var(--brand-400) / <alpha-value>)',
          500: 'rgb(var(--brand-500) / <alpha-value>)',
          600: 'rgb(var(--brand-600) / <alpha-value>)',
          700: 'rgb(var(--brand-700) / <alpha-value>)',
          800: 'rgb(var(--brand-800) / <alpha-value>)',
          900: 'rgb(var(--brand-900) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
};
