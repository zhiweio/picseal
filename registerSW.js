if('serviceWorker' in navigator) {window.addEventListener('load', () => {navigator.serviceWorker.register('https://zhiweio.github.io/picseal/sw.js', { scope: 'https://zhiweio.github.io/picseal/' })})}