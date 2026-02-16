(function() {
  if (window !== window.top) return;

  var scriptTag = document.currentScript || document.querySelector('script[src*="widget.js"]');
  var WIDGET_BASE = '';
  if (scriptTag && scriptTag.src) {
    try {
      var url = new URL(scriptTag.src);
      WIDGET_BASE = url.origin;
    } catch(e) {
      WIDGET_BASE = window.location.origin;
    }
  } else {
    WIDGET_BASE = window.location.origin;
  }
  var detectedLang = 'en';
  if (scriptTag && scriptTag.getAttribute('data-lang')) {
    detectedLang = scriptTag.getAttribute('data-lang');
  } else {
    var htmlLang = document.documentElement.lang || '';
    var navLang = navigator.language || navigator.userLanguage || '';
    var langSource = htmlLang || navLang;
    if (langSource.toLowerCase().indexOf('nl') === 0) {
      detectedLang = 'nl';
    }
  }

  var WIDGET_URL = WIDGET_BASE + '/chat?lang=' + encodeURIComponent(detectedLang);

  function init() {
    if (document.getElementById('dentalai-widget-container')) return;

    var container = document.createElement('div');
    container.id = 'dentalai-widget-container';

    var style = document.createElement('style');
    style.textContent = [
      '#dentalai-widget-button {',
      '  position: fixed;',
      '  bottom: 24px;',
      '  right: 24px;',
      '  width: 60px;',
      '  height: 60px;',
      '  border-radius: 50%;',
      '  background: linear-gradient(135deg, #0891b2, #06b6d4);',
      '  border: 2px solid rgba(255,255,255,0.3);',
      '  cursor: pointer;',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  box-shadow: 0 4px 14px rgba(8, 145, 178, 0.4), 0 0 0 3px rgba(8, 145, 178, 0.15);',
      '  z-index: 2147483646;',
      '  transition: transform 0.2s ease, box-shadow 0.2s ease;',
      '  padding: 0;',
      '  outline: none;',
      '}',
      '#dentalai-widget-button:hover {',
      '  transform: scale(1.08);',
      '  box-shadow: 0 6px 20px rgba(8, 145, 178, 0.5), 0 0 0 3px rgba(8, 145, 178, 0.2);',
      '}',
      '#dentalai-widget-button svg {',
      '  width: 28px;',
      '  height: 28px;',
      '  fill: white;',
      '  pointer-events: none;',
      '}',
      '#dentalai-widget-backdrop {',
      '  position: fixed;',
      '  top: 0;',
      '  left: 0;',
      '  width: 100%;',
      '  height: 100%;',
      '  background: rgba(0, 0, 0, 0.25);',
      '  z-index: 2147483646;',
      '  display: none;',
      '}',
      '#dentalai-widget-iframe-wrap {',
      '  position: fixed;',
      '  bottom: 24px;',
      '  right: 24px;',
      '  width: 400px;',
      '  height: 600px;',
      '  z-index: 2147483647;',
      '  display: none;',
      '  border-radius: 16px;',
      '  overflow: hidden;',
      '  border: 1px solid rgba(0, 0, 0, 0.12);',
      '  box-shadow: 0 25px 60px rgba(0, 0, 0, 0.35), 0 10px 20px rgba(0, 0, 0, 0.2);',
      '  background: #ffffff;',
      '}',
      '#dentalai-widget-iframe {',
      '  width: 100%;',
      '  height: 100%;',
      '  border: none;',
      '  background: #ffffff;',
      '}',
      '@media (max-width: 480px) {',
      '  #dentalai-widget-iframe-wrap {',
      '    width: 100%;',
      '    height: 100%;',
      '    bottom: 0;',
      '    right: 0;',
      '    border-radius: 0;',
      '  }',
      '  #dentalai-widget-backdrop { display: none !important; }',
      '}'
    ].join('\n');

    var backdrop = document.createElement('div');
    backdrop.id = 'dentalai-widget-backdrop';

    var button = document.createElement('button');
    button.id = 'dentalai-widget-button';
    button.setAttribute('aria-label', 'Open chat');
    button.innerHTML = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>';

    var iframeWrap = document.createElement('div');
    iframeWrap.id = 'dentalai-widget-iframe-wrap';

    var iframe = document.createElement('iframe');
    iframe.id = 'dentalai-widget-iframe';
    iframe.title = 'DentalAI Chat';
    iframe.setAttribute('allow', 'microphone');
    iframe.src = WIDGET_URL;

    iframeWrap.appendChild(iframe);

    container.appendChild(style);
    container.appendChild(backdrop);
    container.appendChild(button);
    container.appendChild(iframeWrap);

    document.body.appendChild(container);

    var isOpen = false;

    function openWidget() {
      if (isOpen) return;
      isOpen = true;
      button.style.display = 'none';
      backdrop.style.display = 'block';
      iframeWrap.style.display = 'block';
    }

    function closeWidget() {
      if (!isOpen) return;
      isOpen = false;
      button.style.display = 'flex';
      backdrop.style.display = 'none';
      iframeWrap.style.display = 'none';
    }

    button.addEventListener('click', openWidget);
    backdrop.addEventListener('click', closeWidget);

    window.addEventListener('message', function(event) {
      if (event.data && event.data.type === 'dentalai-close') {
        closeWidget();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
