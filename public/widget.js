(function() {
  // DentalAI Chat Widget Embed Script
  // Add this script to any website to enable the AI receptionist chat widget
  
  const WIDGET_URL = window.location.origin + '/chat';
  
  // Create widget container
  const container = document.createElement('div');
  container.id = 'dentalai-widget-container';
  container.innerHTML = `
    <style>
      #dentalai-widget-button {
        position: fixed;
        bottom: 24px;
        right: 24px;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: linear-gradient(135deg, #0891b2, #06b6d4);
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 12px rgba(8, 145, 178, 0.4);
        z-index: 999998;
        transition: transform 0.2s, box-shadow 0.2s;
      }
      #dentalai-widget-button:hover {
        transform: scale(1.05);
        box-shadow: 0 6px 16px rgba(8, 145, 178, 0.5);
      }
      #dentalai-widget-button svg {
        width: 28px;
        height: 28px;
        fill: white;
      }
      #dentalai-widget-iframe {
        position: fixed;
        bottom: 24px;
        right: 24px;
        width: 380px;
        height: 580px;
        border: none;
        border-radius: 16px;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        z-index: 999999;
        display: none;
      }
      #dentalai-widget-close {
        position: fixed;
        bottom: 560px;
        right: 32px;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: #374151;
        border: none;
        cursor: pointer;
        display: none;
        align-items: center;
        justify-content: center;
        z-index: 1000000;
        color: white;
        font-size: 18px;
      }
      @media (max-width: 480px) {
        #dentalai-widget-iframe {
          width: 100%;
          height: 100%;
          bottom: 0;
          right: 0;
          border-radius: 0;
        }
        #dentalai-widget-close {
          bottom: auto;
          top: 16px;
          right: 16px;
        }
      }
    </style>
    <button id="dentalai-widget-button" aria-label="Open chat">
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
      </svg>
    </button>
    <button id="dentalai-widget-close" aria-label="Close chat">&times;</button>
    <iframe id="dentalai-widget-iframe" src="${WIDGET_URL}" title="DentalAI Chat"></iframe>
  `;
  
  document.body.appendChild(container);
  
  const button = document.getElementById('dentalai-widget-button');
  const iframe = document.getElementById('dentalai-widget-iframe');
  const closeBtn = document.getElementById('dentalai-widget-close');
  
  let isOpen = false;
  
  function toggle() {
    isOpen = !isOpen;
    button.style.display = isOpen ? 'none' : 'flex';
    iframe.style.display = isOpen ? 'block' : 'none';
    closeBtn.style.display = isOpen ? 'flex' : 'none';
  }
  
  button.addEventListener('click', toggle);
  closeBtn.addEventListener('click', toggle);
})();
