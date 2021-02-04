import React, {
  useCallback,
  useEffect,
  useState,
} from 'react';
import {
  useDispatch,
  useSelector,
} from 'react-redux';

import actions from 'actions';
import core from 'core';
import selectors from 'selectors';
import setVerificationResult from 'helpers/setVerificationResult';

import Spinner from './Spinner';
import WidgetInfo from './WidgetInfo/WidgetInfo';
import WidgetLocator from './WidgetLocator';

import './SignaturePanel.scss';

const SignaturePanel = () => {
  const dispatch = useDispatch();
  const [sigWidgets, setSigWidgets] = useState([]);
  const [locatorRect, setLocatorRect] = useState(null);
  const [showSpinner, setShowSpinner] = useState(false);
  const [certificateErrorMessage, setCertificateErrorMessage] = useState('');
  const [isDisabled, certificate] = useSelector(state => [
    selectors.isElementDisabled(state, 'signaturePanel'),
    selectors.getCertificates(state),
  ]);

  const onDocumentLoaded = async() => {
    setShowSpinner(true);

    await core.getAnnotationsLoadedPromise();

    const _sigWidgets = core
      .getAnnotationsList()
      .filter(annotation => annotation instanceof Annotations.SignatureWidgetAnnotation);
    setSigWidgets(_sigWidgets);
  };

  const onDocumentUnloaded = useCallback(() => {
    setShowSpinner(true);
    dispatch(actions.setVerificationResult({}));
  }, [setShowSpinner, dispatch]);

  useEffect(() => {
    core.addEventListener('documentLoaded', onDocumentLoaded);
    core.addEventListener('documentUnloaded', onDocumentUnloaded);
    return () => {
      core.removeEventListener('documentLoaded', onDocumentLoaded);
      core.removeEventListener('documentUnloaded', onDocumentUnloaded);
    };
  }, [dispatch, sigWidgets, onDocumentUnloaded]);

  useEffect(() => {
    if (sigWidgets.length && certificate.length) {
      setVerificationResult(certificate, sigWidgets, dispatch)
        .then(() => {
          setCertificateErrorMessage('');
        })
        /**
         * @todo Consolidate into a single .then?
         */
        .then(() => {
          setShowSpinner(false);
        })
        .catch(e => {
          setCertificateErrorMessage(e.message);
        });
    } else if (!sigWidgets.length && core.getDocument()) {
      // The document is loaded, and the signature widgets need to be retrieved
      onDocumentLoaded();
    } else {
      setShowSpinner(false);
    }
  }, [certificate, dispatch, sigWidgets]);

  /**
   * Side-effect function that highlights the SignatureWidgetAnnotation
   * pertaining to the text element that was clicked by using core code to find
   * the coordinates of the widget on the page it is placed on
   *
   * @param {Annotations.SignatureWidgetAnnotation} widget The widget pertaining
   * to the text element clicked in the Signature Panel
   */
  const jumpToWidget = widget => {
    core.jumpToAnnotation(widget);

    const { scrollLeft, scrollTop } = core.getScrollViewElement();
    const rect = widget.getRect();
    const windowTopLeft = core
      .getDisplayModeObject()
      .pageToWindow({ x: rect.x1, y: rect.y1 }, widget.PageNumber);
    const windowBottomRight = core
      .getDisplayModeObject()
      .pageToWindow({ x: rect.x2, y: rect.y2 }, widget.PageNumber);

    setLocatorRect({
      x1: windowTopLeft.x - scrollLeft,
      y1: windowTopLeft.y - scrollTop,
      x2: windowBottomRight.x - scrollLeft,
      y2: windowBottomRight.y - scrollTop,
    });
  };

  if (isDisabled) {
    return null;
  }

  /**
   * Returns a JSX element if document loading is not complete, or an error
   * occurs, otherwise nothing is returned, indicating that information about
   * one or more signature will be returned from this component
   */
  const renderLoadingOrErrors = () => {
    let result;
    if (showSpinner) {
      result = <Spinner/>;
    } else if (
      certificateErrorMessage === 'Error reading the local certificate'
    ) {
      result = 'There are some issues with reading the local certificate.';
    } else if (certificateErrorMessage === 'Download Failed') {
      result = 'There are some issues with downloading the certificate.';
    } else if (!sigWidgets.length) {
      result = 'This document has no signature fields.';
    } else {
      /**
       * If document has completed loading, there are no errors, and there are
       * signature fields, this function does not need to return anything
       */
      return null;
    }

    return (
      <div className="center">
        {result}
      </div>
    );
  };

  return (
    <div
      className="Panel SignaturePanel"
      data-element="signaturePanel"
    >
      {renderLoadingOrErrors()}
      {
        !showSpinner && sigWidgets.length > 0 && (
          sigWidgets.map((widget, index) => {
            const name = widget.getField().name;
            return (
              <WidgetInfo
                key={index}
                name={name}
                collapsible
                onClick={() => {
                  jumpToWidget(widget);
                }}
              />
            );
          })
        )
      }
      <WidgetLocator rect={locatorRect} />
    </div>
  );
};

export default SignaturePanel;
