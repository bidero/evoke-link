/** @type {import('tailwindcss').Config} */
module.exports = {
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
        // Odcienie wokół niego — używamy klas brand-50 … brand-900.
        brand: {
          50: '#fbf3ff',
          100: '#f4e2ff',
          200: '#ebc6ff',
          300: '#dd9bff',
          400: '#c860ff',
          500: '#a31fde',
          600: '#6e00a5',
          700: '#5b0088',
          800: '#4a006e',
          900: '#3d005a',
        },
      },
    },
  },
  plugins: [],
};
