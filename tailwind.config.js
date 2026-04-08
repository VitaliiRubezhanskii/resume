/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./themes/careercanvas/layouts/**/*.html",
    "./layouts/**/*.html",
    "./content/**/*.md",
  ],
  darkMode: "class",
  theme: {
    extend: {},
  },
  plugins: [require("@tailwindcss/typography")],
};
