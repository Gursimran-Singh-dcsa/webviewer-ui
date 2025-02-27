/* eslint-disable no-unsanitized/property */
import i18n from 'i18next';

import actions from 'actions';
import dayjs from 'dayjs';
import LocalizedFormat from 'dayjs/plugin/localizedFormat';

import { workerTypes } from 'constants/types';
import { getSortStrategies } from 'constants/sortStrategies';
import { mapAnnotationToKey, getDataWithKey } from 'constants/map';
import { isSafari, isChromeOniOS, isFirefoxOniOS } from 'helpers/device';
import DataElements from 'src/constants/dataElement';
import core from 'core';
import getRootNode from './getRootNode';
import { getCurrentViewRect, doesCurrentViewContainEntirePage } from './printCurrentViewHelper';

let pendingCanvases = [];
let PRINT_QUALITY = 1;
let colorMap;
let grayscaleDarknessFactor = 1;
const printResetStyle = `
#print-handler {
  display: none;
}

@media print {
  * {
    display: none! important;
  }

  @page {
    margin: 0; /* Set all margins to 0 */
  }

  html {
    height: 100%;
    display: block! important;
  }

  body {
    height: 100%;
    display: block! important;
    overflow: visible !important;
    padding: 0;
    margin: 0 !important;
  }

  #print-handler {
    display: block !important;
    height: 100%;
    width: 100%;
    padding: 0;
    top: 0;
    bottom: 0;
    left: 0;
    right: 0;
    position: absolute;
  }

  #print-handler img {
    display: block !important;
    max-width: 100%;
    max-height: 100%;
    height: 100%;
    width: 100%;
    object-fit: contain;
    page-break-after: always;
    padding: 0;
    margin: 0;
  }

  #print-handler .page__container {
    box-sizing: border-box;
    display: flex !important;
    flex-direction: column;
    padding: 10px;
    min-height: 100%;
    min-width: 100%;
    font-size: 10px;
  }

  #print-handler .page__container .page__header {
    display: block !important;
    align-self: flex-start;
    font-size: 2rem;
    margin-bottom: 2rem;
    padding-bottom: 0.6rem;
    border-bottom: 0.1rem solid black;
  }

  #print-handler .page__container .note {
    display: flex !important;
    flex-direction: column;
    padding: 0.6rem;
    border: 0.1rem lightgray solid;
    border-radius: 0.4rem;
    margin-bottom: 0.5rem;
  }

  #print-handler .page__container .note .note__info {
    display: block !important;
    font-size: 1.3rem;
    margin-bottom: 0.1rem;
  }

  #print-handler .page__container .note .note__info--with-icon {
    display: flex !important;
  }

  #print-handler .page__container .note .note__info--with-icon .note__icon {
    display: block !important;
    width: 1.65rem;
    height: 1.65rem;
    margin-top: -0.1rem;
    margin-right: 0.2rem;
  }

  #print-handler .page__container .note .note__info--with-icon .note__icon path:not([fill=none]) {
    display: block !important;
    fill: currentColor;
  }

  #print-handler .page__container .note .note__root .note__content {
    display: block !important;
    margin-left: 0.3rem;
  }

  #print-handler .page__container .note .note__root {
    display: block !important;
  }

  #print-handler .page__container .note .note__info--with-icon .note__icon svg {
    display: block !important;
  }

  #print-handler .page__container .note .note__reply {
    display: block !important;
    margin: 0.5rem 0 0 2rem;
  }

  #print-handler .page__container .note .note__content {
    display: block !important;
    font-size: 1.2rem;
    margin-top: 0.1rem;
  }

  #app {
    overflow: visible !important;
  }

  .App {
    display: none !important;
  }

  html, body, #app {
    max-width: none !important;
  }
}
`;

export const setGrayscaleDarknessFactor = (factor) => {
  grayscaleDarknessFactor = factor;
};

dayjs.extend(LocalizedFormat);

export const print = async (dispatch, isEmbedPrintSupported, sortStrategy, colorMap, options = {}) => {
  const {
    includeAnnotations,
    includeComments,
    maintainPageOrientation,
    onProgress,
    printQuality = PRINT_QUALITY,
    printWithoutModal = false,
    language,
    isPrintCurrentView,
    printedNoteDateFormat: dateFormat,
    isGrayscale = false,
    timezone
  } = options;
  let { pagesToPrint } = options;

  if (!core.getDocument()) {
    return;
  }

  const documentType = core.getDocument().getType();
  const bbURLPromise = core.getPrintablePDF();

  if (!isGrayscale && bbURLPromise) {
    const printPage = window.open('', '_blank');
    // eslint-disable-next-line no-unsanitized/method
    printPage.document.write(i18n.t('message.preparingToPrint'));
    bbURLPromise.then((result) => {
      printPage.location.href = result.url;
    });
  } else if (isEmbedPrintSupported && documentType === workerTypes.PDF) {
    dispatch(actions.openElement(DataElements.LOADING_MODAL));
    printPdf().then(() => {
      dispatch(actions.closeElement(DataElements.LOADING_MODAL));
    });
  } else if (includeAnnotations || includeComments || printWithoutModal) {
    if (!pagesToPrint) {
      pagesToPrint = [];
      for (let i = 1; i <= core.getTotalPages(); i++) {
        pagesToPrint.push(i);
      }
    }
    if (isPrintCurrentView) {
      pagesToPrint = [core.getDocumentViewer().getCurrentPage()];
    }

    const createPages = creatingPages(
      pagesToPrint,
      includeComments,
      includeAnnotations,
      maintainPageOrientation,
      printQuality,
      sortStrategy,
      colorMap,
      dateFormat,
      onProgress,
      isPrintCurrentView,
      language,
      false,
      isGrayscale,
      timezone,
    );
    Promise.all(createPages)
      .then((pages) => {
        printPages(pages);
      })
      .catch((e) => {
        console.error(e);
      });
  } else {
    dispatch(actions.openElement('printModal'));
  }
};

const printPdf = () => core.exportAnnotations().then((xfdfString) => {
  const printDocument = true;
  return core
    .getDocument()
    .getFileData({ xfdfString, printDocument })
    .then((data) => {
      const arr = new Uint8Array(data);
      const blob = new Blob([arr], { type: 'application/pdf' });
      const printHandler = getRootNode().getElementById('print-handler');
      printHandler.src = URL.createObjectURL(blob);

      return new Promise((resolve) => {
        const loadListener = function() {
          printHandler.contentWindow.print();
          printHandler.removeEventListener('load', loadListener);

          resolve();
        };

        printHandler.addEventListener('load', loadListener);
      });
    });
});

export const creatingPages = (pagesToPrint, includeComments, includeAnnotations, maintainPageOrientation, printQuality, sortStrategy, clrMap, dateFormat, onProgress, isPrintCurrentView, language, createCanvases = false, isGrayscale = false, timezone) => {
  const createdPages = [];
  pendingCanvases = [];
  PRINT_QUALITY = printQuality;
  colorMap = clrMap;

  pagesToPrint.forEach((pageNumber) => {
    createdPages.push(creatingImage(pageNumber, includeAnnotations, maintainPageOrientation, isPrintCurrentView, createCanvases, isGrayscale));

    if (onProgress) {
      createdPages[createdPages.length - 1].then((htmlElement) => {
        onProgress(pageNumber, htmlElement);
      });
    }

    const printableAnnotationNotes = getPrintableAnnotationNotes(pageNumber);
    if (includeComments && printableAnnotationNotes) {
      const sortedNotes = getSortStrategies()[sortStrategy].getSortedNotes(printableAnnotationNotes);
      if (sortedNotes.length) {
        createdPages.push(creatingNotesPage(sortedNotes, pageNumber, dateFormat, language, timezone));
      }
      if (onProgress) {
        createdPages[createdPages.length - 1].then((htmlElement) => {
          onProgress(pageNumber, htmlElement);
        });
      }
    }
  });

  return createdPages;
};

const getResetPrintStyle = () => {
  const style = document.createElement('style');
  style.id = 'print-handler-css';
  style.textContent = printResetStyle;
  return style;
};

export const printPages = (pages) => {
  const printHandler = getRootNode().getElementById('print-handler');
  printHandler.innerHTML = '';
  const isApryseWebViewerWebComponent = window.isApryseWebViewerWebComponent;

  if (isApryseWebViewerWebComponent) {
    // In the Web component mode, the window.print function uses the top window as target for printing.
    // The approach here is to teleport the print handler div to the top parent and inject some CSS
    // to make it print nicely
    printHandler.parentNode.removeChild(printHandler);
    document.body.appendChild(printHandler);
    if (!document.getElementById('print-handler-css')) {
      const style = getResetPrintStyle();
      document.head.appendChild(style);
    }
  }

  const fragment = document.createDocumentFragment();
  pages.forEach((page) => {
    fragment.appendChild(page);
  });

  printHandler.appendChild(fragment);

  if (isSafari && !(isChromeOniOS || isFirefoxOniOS)) {
    // Print for Safari browser. Makes Safari 11 consistently work.
    document.execCommand('print');
  } else {
    // It looks like both Chrome and Firefox (on iOS) use the top window as target for window.print instead of the frame where it was triggered,
    // so we need to teleport the print handler div to the top parent and inject some CSS to make it print nicely.
    // This can be removed when Chrome and Firefox for iOS respect the origin frame as the actual target for window.print
    if (isChromeOniOS || isFirefoxOniOS) {
      const node = isApryseWebViewerWebComponent ? getRootNode() : window.parent.document;
      if (node.getElementById('print-handler')) {
        node.getElementById('print-handler').remove();
      }
      node.appendChild(printHandler.cloneNode(true));

      if (!node.getElementById('print-handler-css')) {
        const style = getResetPrintStyle();
        const node = isApryseWebViewerWebComponent ? getRootNode() : window.parent.document.head;
        node.appendChild(style);
      }
    }

    printDocument();
  }
};

const printDocument = () => {
  const doc = core.getDocument();
  const tempTitle = window.parent.document.title;

  if (!doc) {
    return;
  }

  const fileName = doc.getFilename();
  const fileNameWithoutExtension = fileName.substring(0, fileName.lastIndexOf('.')) || fileName;

  const onBeforePrint = () => {
    window.parent.document.title = fileNameWithoutExtension;
  };

  const onAfterPrint = () => {
    window.parent.document.title = tempTitle;

    if (window.isApryseWebViewerWebComponent) {
      const printHandler = document.getElementById('print-handler');
      document.body.removeChild(printHandler);
      const parentElement = getRootNode().querySelector('.PrintHandler');
      parentElement.appendChild(printHandler);
    }
  };

  window.addEventListener('beforeprint', onBeforePrint, { once: true });
  window.addEventListener('afterprint', onAfterPrint, { once: true });
  window.print();
};

export const cancelPrint = () => {
  const doc = core.getDocument();
  pendingCanvases.forEach((id) => doc.cancelLoadCanvas(id));
};

export const getPrintableAnnotationNotes = (pageNumber) => core
  .getAnnotationsList()
  .filter(
    (annotation) => annotation.Listable &&
      annotation.PageNumber === pageNumber &&
      !annotation.isReply() &&
      !annotation.isGrouped() &&
      annotation.Printable,
  );

const creatingImage = (pageNumber, includeAnnotations, maintainPageOrientation, isPrintCurrentView, createCanvases = false, isGrayscale = false) => new Promise((resolve) => {
  const pageIndex = pageNumber - 1;
  const printRotation = getPrintRotation(pageIndex, maintainPageOrientation);
  const onCanvasLoaded = async (canvas) => {
    pendingCanvases = pendingCanvases.filter((pendingCanvas) => pendingCanvas !== id);
    positionCanvas(canvas, pageIndex);
    let printableAnnotInfo = [];
    if (!includeAnnotations) {
      // according to Adobe, even if we exclude annotations, it will still draw widget annotations
      const annotatationsToPrint = core.getAnnotationsList().filter((annotation) => {
        return annotation.PageNumber === pageNumber && !(annotation instanceof window.Core.Annotations.WidgetAnnotation);
      });
      // store the previous Printable value so that we can set it back later
      printableAnnotInfo = annotatationsToPrint.map((annotation) => ({
        annotation, printable: annotation.Printable
      }));
      // set annotations to false so that it won't show up in the printed page
      annotatationsToPrint.forEach((annotation) => {
        annotation.Printable = false;
      });
    }

    if (isGrayscale && grayscaleDarknessFactor >= 1) {
      const ctx = canvas.getContext('2d');
      // Get the old transform before reset because the annotation canvas will need it
      const oldTransform = ctx.getTransform();
      // Reset underlying transforms. This seems only for DWG (WVS) but could happen elsewhere.
      ctx.resetTransform();
      ctx.globalCompositeOperation = 'color';
      ctx.fillStyle = 'white';
      ctx.globalAlpha = 1;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'source-over';
      ctx.setTransform(oldTransform);
    } else if (isGrayscale) {
      const ctx = canvas.getContext('2d');
      ctx.globalCompositeOperation = 'source-over';
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const { data } = imageData;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 255) {
          continue;
        }
        data[i] = data[i + 1] = data[i + 2] = ((data[i] + data[i + 1] + data[i + 2]) / 3) * grayscaleDarknessFactor;
      }
      ctx.putImageData(imageData, 0, 0);
    }

    const alwaysPrintAnnotationsInColor = core.getDocumentViewer().isAlwaysPrintAnnotationsInColorEnabled();
    const drawAnnotationsInGrayscale = isGrayscale && !alwaysPrintAnnotationsInColor;
    await drawAnnotationsOnCanvas(canvas, pageNumber, drawAnnotationsInGrayscale);

    printableAnnotInfo.forEach((info) => {
      info.annotation.Printable = info.printable;
    });

    if (createCanvases) {
      resolve(canvas.toDataURL());
    }

    const img = document.createElement('img');
    img.src = canvas.toDataURL();
    img.onload = () => {
      resolve(img);
    };
  };

  let zoom = 1;
  let renderRect;
  if (isPrintCurrentView) {
    zoom = core.getZoom();
    renderRect = getCurrentViewRect(pageNumber);

    const pageDimensions = core.getDocument().getPageInfo(pageNumber);
    if (doesCurrentViewContainEntirePage(renderRect, pageDimensions)) {
      renderRect = undefined;
    }
  }

  if (!renderRect) {
    zoom = calculatePageZoom(pageNumber);
  }

  const id = core.getDocument().loadCanvas({
    pageNumber,
    zoom,
    pageRotation: printRotation,
    drawComplete: onCanvasLoaded,
    multiplier: PRINT_QUALITY,
    'print': true,
    renderRect
  });

  pendingCanvases.push(id);
});

export const creatingNotesPage = (annotations, pageNumber, dateFormat, language, timezone) => new Promise((resolve) => {
  const container = document.createElement('div');
  container.className = 'page__container';

  const header = document.createElement('div');
  header.className = 'page__header';
  header.innerHTML = `${i18n.t('option.shared.page')} ${pageNumber}`;

  container.appendChild(header);
  annotations.forEach((annotation) => {
    const note = getNote(annotation, dateFormat, language, timezone);

    container.appendChild(note);
  });

  resolve(container);
});

const getPrintRotation = (pageIndex, maintainPageOrientation) => {
  if (!maintainPageOrientation) {
    const { width, height } = core.getPageInfo(pageIndex + 1);
    const documentRotation = getDocumentRotation(pageIndex);
    let printRotation = (4 - documentRotation) % 4;

    // automatically rotate pages so that they fill up as much of the printed page as possible
    if (printRotation % 2 === 0 && width > height) {
      printRotation++;
    } else if (printRotation % 2 === 1 && height > width) {
      printRotation = 0;
    }
    return printRotation;
  }

  return core.getRotation(pageIndex + 1);
};

const positionCanvas = (canvas, pageIndex) => {
  const { width, height } = core.getPageInfo(pageIndex + 1);
  const documentRotation = getDocumentRotation(pageIndex);
  const ctx = canvas.getContext('2d');

  const printRotation = (4 - documentRotation) % 4;
  // To check if automatic print rotation will be applied
  const isAutoRotated = ((printRotation % 2 === 0 && width > height) || (printRotation % 2 === 1 && height > width));

  // If this is pdf js and auto rotated, apply different transform
  if (window.Core.isPdfjs && isAutoRotated) {
    switch (documentRotation) {
      case 0:
        ctx.translate(height, 0);
        ctx.rotate((90 * Math.PI) / 180);
        break;
      case 1:
        ctx.translate(0, height);
        ctx.rotate((270 * Math.PI) / 180);
        break;
      case 2:
        ctx.translate(height, 0);
        ctx.rotate((-270 * Math.PI) / 180);
        break;
      case 3:
        ctx.translate(0, height);
        ctx.rotate((270 * Math.PI) / 180);
        break;
    }
  } else if (!window.Core.isPdfjs) {
    switch (documentRotation) {
      case 1:
        ctx.translate(width, 0);
        break;
      case 2:
        ctx.translate(width, height);
        break;
      case 3:
        ctx.translate(0, height);
        break;
    }
    ctx.rotate((documentRotation * 90 * Math.PI) / 180);
  }
};

const drawAnnotationsOnCanvas = (canvas, pageNumber, isGrayscale) => {
  if (isGrayscale) {
    const ctx = canvas.getContext('2d');
    ctx.filter = 'grayscale(1)';
  }

  const widgetAnnotations = core
    .getAnnotationsList()
    .filter((annotation) => annotation.PageNumber === pageNumber && annotation instanceof window.Core.Annotations.WidgetAnnotation);
  // just draw markup annotations
  if (widgetAnnotations.length === 0) {
    return core.drawAnnotations(pageNumber, canvas);
  }
  // draw all annotations
  const widgetContainer = createWidgetContainer(pageNumber - 1);
  return core.drawAnnotations(pageNumber, canvas, true, widgetContainer).then(() => {
    const node = (window.isApryseWebViewerWebComponent) ? getRootNode() : document.body;
    node.appendChild(widgetContainer);
    return import(/* webpackChunkName: 'html2canvas' */ 'html2canvas').then(({ default: html2canvas }) => {
      return html2canvas(widgetContainer, {
        canvas,
        backgroundColor: null,
        scale: 1,
        logging: false,
      }).then(() => {
        node.removeChild(widgetContainer);
      });
    });
  });
};

const getDocumentRotation = (pageIndex) => {
  const pageNumber = pageIndex + 1;
  const completeRotation = core.getCompleteRotation(pageNumber);
  const viewerRotation = core.getRotation(pageNumber);

  return (completeRotation - viewerRotation + 4) % 4;
};

const getNote = (annotation, dateFormat, language, timezone) => {
  const note = document.createElement('div');
  note.className = 'note';

  const noteRoot = document.createElement('div');
  noteRoot.className = 'note__root';

  const noteRootInfo = document.createElement('div');
  noteRootInfo.className = 'note__info--with-icon';

  const noteIcon = getNoteIcon(annotation);

  noteRootInfo.appendChild(noteIcon);
  noteRootInfo.appendChild(getNoteInfo(annotation, dateFormat, language, timezone));
  noteRoot.appendChild(noteRootInfo);
  noteRoot.appendChild(getNoteContent(annotation));

  note.appendChild(noteRoot);
  annotation.getReplies().forEach((reply) => {
    const noteReply = document.createElement('div');
    noteReply.className = 'note__reply';
    noteReply.appendChild(getNoteInfo(reply, dateFormat, language, timezone));
    noteReply.appendChild(getNoteContent(reply));

    note.appendChild(noteReply);
  });

  return note;
};

const getNoteIcon = (annotation) => {
  const key = mapAnnotationToKey(annotation);
  const iconColor = colorMap[key] && colorMap[key].iconColor;
  const icon = getDataWithKey(key).icon;
  const isBase64 = icon && icon.trim().indexOf('data:') === 0;

  let noteIcon;
  if (isBase64) {
    noteIcon = document.createElement('img');
    noteIcon.src = icon;
  } else {
    let innerHTML;
    if (icon) {
      const isInlineSvg = icon.indexOf('<svg') === 0;
      /* eslint-disable global-require */
      // eslint-disable-next-line import/no-dynamic-require
      innerHTML = isInlineSvg ? icon : require(`../../assets/icons/${icon}.svg`);
    } else {
      innerHTML = annotation.Subject;
    }

    noteIcon = document.createElement('div');
    noteIcon.innerHTML = innerHTML;
  }

  noteIcon.className = 'note__icon';
  noteIcon.style.color = iconColor && annotation[iconColor].toHexString();
  return noteIcon;
};

const getNoteInfo = (annotation, dateFormat, language, timezone) => {
  let dateCreated;
  if (timezone) {
    const datetimeStr = annotation.DateCreated.toLocaleString('en-US', { timeZone: timezone });
    dateCreated = new Date(datetimeStr);
  } else {
    dateCreated = annotation.DateCreated;
  }
  const info = document.createElement('div');
  let date = dayjs(dateCreated).format(dateFormat);

  if (language) {
    date = dayjs(dateCreated).locale(language).format(dateFormat);
  }

  info.className = 'note__info';
  if (annotation.Subject === '' || annotation.Subject === null || annotation.Subject === undefined) {
    info.innerHTML = `
      ${i18n.t('option.printInfo.author')}: ${core.getDisplayAuthor(annotation['Author']) || ''} &nbsp;&nbsp;
      ${i18n.t('option.printInfo.date')}: ${date}
    `;
  } else {
    info.innerHTML = `
      ${i18n.t('option.printInfo.author')}: ${core.getDisplayAuthor(annotation['Author']) || ''} &nbsp;&nbsp;
      ${i18n.t('option.printInfo.subject')}: ${annotation.Subject} &nbsp;&nbsp;
      ${i18n.t('option.printInfo.date')}: ${date}
    `;
  }

  return info;
};

const getNoteContent = (annotation) => {
  const contentElement = document.createElement('div');
  const contentText = annotation.getContents();

  contentElement.className = 'note__content';
  if (contentText) {
    // ensure that new lines are preserved and rendered properly
    contentElement.style.whiteSpace = 'pre-wrap';
    contentElement.innerHTML = `${contentText}`;
  }
  return contentElement;
};

const createWidgetContainer = (pageIndex) => {
  const { width, height } = core.getPageInfo(pageIndex + 1);
  const widgetContainer = document.createElement('div');

  widgetContainer.id = 'printWidgetContainer';
  widgetContainer.style.width = width;
  widgetContainer.style.height = height;
  widgetContainer.style.position = 'relative';
  widgetContainer.style.top = '-10000px';

  return widgetContainer;
};

const calculatePageZoom = (pageNumber) => {
  let zoom = 1;

  // cap the size that we render the page at when printing
  const pageInfo = core.getDocument().getPageInfo(pageNumber);
  const pageSize = Math.sqrt(pageInfo.width * pageInfo.height);
  const pageSizeTarget = 2500;

  if (pageSize > pageSizeTarget) {
    zoom = pageSizeTarget / pageSize;
  }

  return zoom;
};