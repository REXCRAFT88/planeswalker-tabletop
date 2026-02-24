/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./index.tsx",
        "./App.tsx",
        "./components/**/*.{tsx,ts}",
        "./services/**/*.{tsx,ts}",
    ],
    theme: {
        extend: {},
    },
    plugins: [],
};
