(function() {
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
  var WIDGET_URL = WIDGET_BASE + '/chat';

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
      '  border: none;',
      '  cursor: pointer;',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  box-shadow: 0 4px 14px rgba(8, 145, 178, 0.4);',
      '  z-index: 999998;',
      '  transition: transform 0.2s ease, box-shadow 0.2s ease;',
      '  padding: 0;',
      '  outline: none;',
      '}',
      '#dentalai-widget-button:hover {',
      '  transform: scale(1.08);',
      '  box-shadow: 0 6px 20px rgba(8, 145, 178, 0.5);',
      '}',
      '#dentalai-widget-button svg {',
      '  width: 28px;',
      '  height: 28px;',
      '  fill: white;',
      '  pointer-events: none;',
      '}',
      '#dentalai-widget-iframe-wrap {',
      '  position: fixed;',
      '  bottom: 24px;',
      '  right: 24px;',
      '  width: 380px;',
      '  height: 580px;',
      '  z-index: 999999;',
      '  display: none;',
      '  flex-direction: column;',
      '  border-radius: 16px;',
      '  overflow: hidden;',
      '  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);',
      '}',
      '#dentalai-widget-header {',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: space-between;',
      '  background: #0891b2;',
      '  color: white;',
      '  padding: 10px 16px;',
      '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;',
      '  font-size: 14px;',
      '  font-weight: 600;',
      '}',
      '#dentalai-widget-close {',
      '  background: none;',
      '  border: none;',
      '  color: white;',
      '  cursor: pointer;',
      '  font-size: 22px;',
      '  line-height: 1;',
      '  padding: 0 4px;',
      '  opacity: 0.8;',
      '  transition: opacity 0.15s;',
      '}',
      '#dentalai-widget-close:hover {',
      '  opacity: 1;',
      '}',
      '#dentalai-widget-iframe {',
      '  width: 100%;',
      '  height: 100%;',
      '  border: none;',
      '  flex: 1;',
      '  background: white;',
      '}',
      '@media (max-width: 480px) {',
      '  #dentalai-widget-iframe-wrap {',
      '    width: 100%;',
      '    height: 100%;',
      '    bottom: 0;',
      '    right: 0;',
      '    border-radius: 0;',
      '  }',
      '}'
    ].join('\n');

    var button = document.createElement('button');
    button.id = 'dentalai-widget-button';
    button.setAttribute('aria-label', 'Open chat');
    button.innerHTML = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>';

    var iframeWrap = document.createElement('div');
    iframeWrap.id = 'dentalai-widget-iframe-wrap';

    var header = document.createElement('div');
    header.id = 'dentalai-widget-header';
    var title = document.createElement('span');
    title.textContent = 'Chat with us';
    var closeBtn = document.createElement('button');
    closeBtn.id = 'dentalai-widget-close';
    closeBtn.setAttribute('aria-label', 'Close chat');
    closeBtn.innerHTML = '&times;';
    header.appendChild(title);
    header.appendChild(closeBtn);

    var iframe = document.createElement('iframe');
    iframe.id = 'dentalai-widget-iframe';
    iframe.title = 'DentalAI Chat';
    iframe.setAttribute('allow', 'microphone');

    iframeWrap.appendChild(header);
    iframeWrap.appendChild(iframe);

    container.appendChild(style);
    container.appendChild(button);
    container.appendChild(iframeWrap);

    document.body.appendChild(container);

    var isOpen = false;
    var iframeLoaded = false;

    function toggle() {
      isOpen = !isOpen;
      if (isOpen && !iframeLoaded) {
        iframe.src = WIDGET_URL;
        iframeLoaded = true;
      }
      button.style.display = isOpen ? 'none' : 'flex';
      iframeWrap.style.display = isOpen ? 'flex' : 'none';
    }

    button.addEventListener('click', toggle);
    closeBtn.addEventListener('click', toggle);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
