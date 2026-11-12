(function(){try{var t=localStorage.getItem('theme');if(!t)t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
document.documentElement.setAttribute('data-theme',t);
var l=localStorage.getItem('lang')||((navigator.language||'').toLowerCase().indexOf('hi')===0?'hi':'en');
document.documentElement.setAttribute('lang',l);}catch(e){}})();
