/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./main/**/*.{html,js,ts}",
    "./src/**/*.{html,js,ts}"
  ],
  theme: {
    extend: {
      colors: {
        bgPrimary: '#0b0f19',
        accentPrimary: '#6366f1',
        accentSecondary: '#ec4899',
      }
    },
  },
  plugins: [],
}
