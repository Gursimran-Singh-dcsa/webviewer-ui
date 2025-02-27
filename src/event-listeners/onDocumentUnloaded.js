import actions from 'actions';
import core from 'core';
import overlays from '../constants/overlays';

export default (dispatch, documentViewerKey) => () => {
  dispatch(
    actions.closeElements([
      'pageNavOverlay',
      'notesPanel',
      'searchPanel',
      'leftPanel',
      'signatureValidationModal',
      'audioPlaybackPopup',
      'redactionPanel',
      'textEditingPanel',
      'wv3dPropertiesPanel',
      'watermarkPanel',
      ...overlays,
    ]),
  );
  // TODO Compare: Integrate with panels
  if (documentViewerKey === 1) {
    dispatch(actions.setOutlines([]));
    dispatch(actions.setBookmarks({}));
    dispatch(actions.setPortfolio([]));
    dispatch(actions.setTotalPages(0));
    dispatch(actions.setSearchValue(''));
    core.clearSearchResults();
  }
  dispatch(actions.setZoom(1, documentViewerKey));
};
