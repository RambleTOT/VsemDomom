/* @ds-bundle: {"format":4,"namespace":"MAXUIDesignSystem_b9d019","components":[{"name":"AvatarContainer","sourcePath":"components/avatar/Avatar.jsx"},{"name":"AvatarImage","sourcePath":"components/avatar/Avatar.jsx"},{"name":"AvatarText","sourcePath":"components/avatar/Avatar.jsx"},{"name":"AvatarIcon","sourcePath":"components/avatar/Avatar.jsx"},{"name":"AvatarOverlay","sourcePath":"components/avatar/Avatar.jsx"},{"name":"AvatarCloseButton","sourcePath":"components/avatar/Avatar.jsx"},{"name":"Avatar","sourcePath":"components/avatar/Avatar.jsx"},{"name":"Button","sourcePath":"components/buttons/Button.jsx"},{"name":"IconButton","sourcePath":"components/buttons/IconButton.jsx"},{"name":"CellAction","sourcePath":"components/cells/CellAction.jsx"},{"name":"CellHeader","sourcePath":"components/cells/CellHeader.jsx"},{"name":"CellInput","sourcePath":"components/cells/CellInput.jsx"},{"name":"CellList","sourcePath":"components/cells/CellList.jsx"},{"name":"CellSimple","sourcePath":"components/cells/CellSimple.jsx"},{"name":"Icon16Chevron","sourcePath":"components/core/Icons.jsx"},{"name":"Icon16CloseIos","sourcePath":"components/core/Icons.jsx"},{"name":"Icon16SearchOutline","sourcePath":"components/core/Icons.jsx"},{"name":"Icon20CloseAndroid","sourcePath":"components/core/Icons.jsx"},{"name":"Icon20CloseFilled","sourcePath":"components/core/Icons.jsx"},{"name":"Icon24CloseAndroid","sourcePath":"components/core/Icons.jsx"},{"name":"Icons","sourcePath":"components/core/Icons.jsx"},{"name":"MaxUIContext","sourcePath":"components/core/MaxUI.jsx"},{"name":"MaxUI","sourcePath":"components/core/MaxUI.jsx"},{"name":"Counter","sourcePath":"components/feedback/Counter.jsx"},{"name":"Spinner","sourcePath":"components/feedback/Spinner.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Radio","sourcePath":"components/forms/Radio.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"Textarea","sourcePath":"components/forms/Textarea.jsx"},{"name":"Container","sourcePath":"components/layout/Container.jsx"},{"name":"EllipsisText","sourcePath":"components/layout/EllipsisText.jsx"},{"name":"Flex","sourcePath":"components/layout/Flex.jsx"},{"name":"Grid","sourcePath":"components/layout/Grid.jsx"},{"name":"Panel","sourcePath":"components/layout/Panel.jsx"},{"name":"TypographyDisplay","sourcePath":"components/typography/Typography.jsx"},{"name":"TypographyHeadline","sourcePath":"components/typography/Typography.jsx"},{"name":"TypographyTitle","sourcePath":"components/typography/Typography.jsx"},{"name":"TypographyBody","sourcePath":"components/typography/Typography.jsx"},{"name":"TypographyLabel","sourcePath":"components/typography/Typography.jsx"},{"name":"TypographyAction","sourcePath":"components/typography/Typography.jsx"},{"name":"TypographyText","sourcePath":"components/typography/Typography.jsx"},{"name":"Typography","sourcePath":"components/typography/Typography.jsx"},{"name":"ClearableInput","sourcePath":"components/utility/ClearableInput.jsx"},{"name":"Ripple","sourcePath":"components/utility/Ripple.jsx"},{"name":"SvgButton","sourcePath":"components/utility/SvgButton.jsx"},{"name":"Tappable","sourcePath":"components/utility/Tappable.jsx"}],"sourceHashes":{"components/avatar/Avatar.jsx":"59b659926401","components/buttons/Button.jsx":"33c9258ada9e","components/buttons/IconButton.jsx":"341baf1a27c5","components/cells/CellAction.jsx":"63ac3bc492ec","components/cells/CellHeader.jsx":"97594b369a89","components/cells/CellInput.jsx":"138daba667aa","components/cells/CellList.jsx":"3cae07c2f133","components/cells/CellSimple.jsx":"c7ddd53ea2e2","components/core/Icons.jsx":"72877bd37f1b","components/core/MaxUI.jsx":"9e2244aa9890","components/feedback/Counter.jsx":"1c7981f6dc17","components/feedback/Spinner.jsx":"1e94ef42ae30","components/forms/Input.jsx":"b23c89142a59","components/forms/Radio.jsx":"750c5a483e8c","components/forms/Switch.jsx":"5bf4d106b27e","components/forms/Textarea.jsx":"3de8f78dd186","components/layout/Container.jsx":"97b2e92972d5","components/layout/EllipsisText.jsx":"dc43d0cbdeb8","components/layout/Flex.jsx":"076c15089d91","components/layout/Grid.jsx":"aa435b3d2bc3","components/layout/Panel.jsx":"445711d6290b","components/typography/Typography.jsx":"20bc5200577b","components/utility/ClearableInput.jsx":"605caecb6017","components/utility/Ripple.jsx":"14eaa8042ad4","components/utility/SvgButton.jsx":"340e5bf02327","components/utility/Tappable.jsx":"e38bd8530720","ui_kits/mini-app/ChatsScreen.jsx":"9536de1610b3","ui_kits/mini-app/FeedbackScreen.jsx":"4a82d23e99b9","ui_kits/mini-app/ProfileScreen.jsx":"718f977c30a5","ui_kits/mini-app/SettingsScreen.jsx":"d41e17d48029","ui_kits/mini-app/Shared.jsx":"24680eff003f"},"inlinedExternals":[],"unexposedExports":[{"name":"cx","sourcePath":"components/core/MaxUI.jsx"},{"name":"useColorScheme","sourcePath":"components/core/MaxUI.jsx"},{"name":"usePlatform","sourcePath":"components/core/MaxUI.jsx"}]} */

(() => {

const __ds_ns = (window.MAXUIDesignSystem_b9d019 = window.MAXUIDesignSystem_b9d019 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Icons.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const P = {
  chevron: 'M2.93433 3.43433C3.24675 3.12191 3.75328 3.12191 4.0657 3.43433L8.0657 7.43433C8.37812 7.74675 8.37812 8.25328 8.0657 8.5657L4.0657 12.5657C3.75328 12.8781 3.24675 12.8781 2.93433 12.5657C2.62191 12.2533 2.62191 11.7467 2.93433 11.4343L6.36864 8.00001L2.93433 4.5657C2.62191 4.25328 2.62191 3.74675 2.93433 3.43433Z',
  closeIos: 'M8 16C12.4183 16 16 12.4183 16 8C16 3.58172 12.4183 0 8 0C3.58172 0 0 3.58172 0 8C0 12.4183 3.58172 16 8 16ZM5.5657 4.43433C5.25328 4.12191 4.74675 4.12191 4.43433 4.43433C4.12191 4.74675 4.12191 5.25328 4.43433 5.5657L6.86864 8.00001L4.43433 10.4343C4.12191 10.7467 4.12191 11.2533 4.43433 11.5657C4.74675 11.8781 5.25328 11.8781 5.5657 11.5657L8.00001 9.13138L10.4343 11.5657C10.7467 11.8781 11.2533 11.8781 11.5657 11.5657C11.8781 11.2533 11.8781 10.7467 11.5657 10.4343L9.13138 8.00001L11.5657 5.5657C11.8781 5.25328 11.8781 4.74675 11.5657 4.43433C11.2533 4.12191 10.7467 4.12191 10.4343 4.43433L8.00001 6.86864L5.5657 4.43433Z',
  search: 'M7.24205 2.11542C4.63716 2.11542 2.56544 4.15946 2.56544 6.63236C2.56544 9.10526 4.63716 11.1493 7.24205 11.1493C9.84694 11.1493 11.9187 9.10526 11.9187 6.63236C11.9187 4.15946 9.84694 2.11542 7.24205 2.11542ZM1 6.63236C1 3.25142 3.81673 0.549988 7.24205 0.549988C10.6674 0.549988 13.4841 3.25142 13.4841 6.63236C13.4841 8.24986 12.8394 9.71183 11.7918 10.7969L14.7921 14.0436C15.0855 14.361 15.066 14.8563 14.7485 15.1496C14.431 15.443 13.9358 15.4235 13.6424 15.106L10.5683 11.7795C9.60299 12.3726 8.46106 12.7147 7.24205 12.7147C3.81673 12.7147 1 10.0133 1 6.63236Z',
  close20: 'M4.36358 4.36358C4.71505 4.01211 5.2849 4.01211 5.63637 4.36358L9.99998 8.72718L14.3636 4.36358C14.7151 4.01211 15.2849 4.01211 15.6364 4.36358C15.9878 4.71505 15.9878 5.2849 15.6364 5.63637L11.2728 9.99998L15.6364 14.3636C15.9878 14.7151 15.9878 15.2849 15.6364 15.6364C15.2849 15.9878 14.7151 15.9878 14.3636 15.6364L9.99998 11.2728L5.63637 15.6364C5.2849 15.9878 4.71505 15.9878 4.36358 15.6364C4.01211 15.2849 4.01211 14.7151 4.36358 14.3636L8.72718 9.99998L4.36358 5.63637C4.01211 5.2849 4.01211 4.71505 4.36358 4.36358Z',
  closeFilledX: 'M5.3637 5.36358C5.71517 5.01211 6.28502 5.01211 6.63649 5.36358L10.0001 8.72718L13.3637 5.36358C13.7152 5.01211 14.285 5.01211 14.6365 5.36358C14.988 5.71505 14.988 6.2849 14.6365 6.63637L11.2729 9.99998L14.6365 13.3636C14.988 13.7151 14.988 14.2849 14.6365 14.6364C14.285 14.9878 13.7152 14.9878 13.3637 14.6364L10.0001 11.2728L6.63649 14.6364C6.28502 14.9878 5.71517 14.9878 5.3637 14.6364C5.01223 14.2849 5.01223 13.7151 5.3637 13.3636L8.72731 9.99998L5.3637 6.63637C5.01223 6.2849 5.01223 5.71505 5.3637 5.36358Z',
  close24: 'M6.26807 6.26807C6.6255 5.91064 7.20501 5.91064 7.56244 6.26807L12 10.7056L16.4376 6.26807C16.795 5.91064 17.3745 5.91064 17.7319 6.26807C18.0894 6.6255 18.0894 7.20501 17.7319 7.56244L13.2944 12L17.7319 16.4376C18.0894 16.795 18.0894 17.3745 17.7319 17.7319C17.3745 18.0894 16.795 18.0894 16.4376 17.7319L12 13.2944L7.56244 17.7319C7.20501 18.0894 6.6255 18.0894 6.26807 17.7319C5.91064 17.3745 5.91064 16.795 6.26807 16.4376L10.7056 12L6.26807 7.56244C5.91064 7.20501 5.91064 6.6255 6.26807 6.26807Z'
};
const svg = (w, h, vb, kids, props) => /*#__PURE__*/React.createElement("svg", _extends({
  width: w,
  height: h,
  viewBox: vb,
  fill: "none",
  xmlns: "http://www.w3.org/2000/svg",
  "aria-hidden": "true"
}, props), kids);
const path = d => /*#__PURE__*/React.createElement("path", {
  fillRule: "evenodd",
  clipRule: "evenodd",
  d: d,
  fill: "currentColor"
});
function Icon16Chevron(props) {
  return svg(12, 16, '0 0 12 16', path(P.chevron), props);
}
function Icon16CloseIos(props) {
  return svg(16, 16, '0 0 16 16', path(P.closeIos), props);
}
function Icon16SearchOutline(props) {
  return svg(16, 16, '0 0 16 16', path(P.search), props);
}
function Icon20CloseAndroid(props) {
  return svg(20, 20, '0 0 20 20', path(P.close20), props);
}
function Icon20CloseFilled(props) {
  return svg(20, 20, '0 0 20 20', [/*#__PURE__*/React.createElement("circle", {
    key: "c",
    cx: "10",
    cy: "10",
    r: "10",
    fill: "currentColor"
  }), /*#__PURE__*/React.createElement("path", {
    key: "p",
    fillRule: "evenodd",
    clipRule: "evenodd",
    d: P.closeFilledX,
    fill: "white"
  })], props);
}
function Icon24CloseAndroid(props) {
  return svg(24, 24, '0 0 24 24', path(P.close24), props);
}
const Icons = {
  Icon16Chevron,
  Icon16CloseIos,
  Icon16SearchOutline,
  Icon20CloseAndroid,
  Icon20CloseFilled,
  Icon24CloseAndroid
};
Object.assign(__ds_scope, { Icon16Chevron, Icon16CloseIos, Icon16SearchOutline, Icon20CloseAndroid, Icon20CloseFilled, Icon24CloseAndroid, Icons });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Icons.jsx", error: String((e && e.message) || e) }); }

// components/core/MaxUI.jsx
try { (() => {
const cx = (...a) => a.filter(Boolean).join(' ');
const MaxUIContext = React.createContext({
  platform: 'ios',
  colorScheme: 'light'
});
const usePlatform = () => React.useContext(MaxUIContext).platform;
const useColorScheme = () => React.useContext(MaxUIContext).colorScheme;
const detectIos = () => typeof navigator !== 'undefined' && /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);
const systemScheme = () => typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

/** Root provider: sets platform (ios|android) + color scheme (light|dark) tokens for its subtree. */
function MaxUI({
  children,
  className,
  style,
  platform,
  colorScheme,
  resetBody = false
}) {
  const p = platform || (detectIos() ? 'ios' : 'android');
  const [sys, setSys] = React.useState(systemScheme);
  React.useEffect(() => {
    if (colorScheme || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const h = () => setSys(mq.matches ? 'dark' : 'light');
    mq.addEventListener && mq.addEventListener('change', h);
    return () => mq.removeEventListener && mq.removeEventListener('change', h);
  }, [colorScheme]);
  React.useEffect(() => {
    if (resetBody) {
      const o = document.body.style.margin;
      document.body.style.margin = '0';
      return () => {
        document.body.style.margin = o;
      };
    }
  }, [resetBody]);
  const s = colorScheme || sys;
  const value = React.useMemo(() => ({
    platform: p,
    colorScheme: s
  }), [p, s]);
  return /*#__PURE__*/React.createElement(MaxUIContext.Provider, {
    value: value
  }, /*#__PURE__*/React.createElement("div", {
    className: cx('mx-root', 'max-' + p, 'max-' + s, className),
    style: style
  }, children));
}
Object.assign(__ds_scope, { cx, MaxUIContext, usePlatform, useColorScheme, MaxUI });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/MaxUI.jsx", error: String((e && e.message) || e) }); }

// components/cells/CellHeader.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function CellHeader({
  className,
  titleStyle = 'caps',
  fullWidth = false,
  children,
  after,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: __ds_scope.cx('mx-ch', 'mx-ch--' + titleStyle, fullWidth && 'mx-ch--full', className)
  }, rest), children != null && /*#__PURE__*/React.createElement("div", {
    className: __ds_scope.cx('mx-ch__content', titleStyle === 'caps' ? 'mx-t-caps' : 'mx-t-label-strong')
  }, children), after != null && /*#__PURE__*/React.createElement("div", {
    className: "mx-ch__after"
  }, after));
}
Object.assign(__ds_scope, { CellHeader });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/cells/CellHeader.jsx", error: String((e && e.message) || e) }); }

// components/cells/CellList.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function CellList({
  className,
  header,
  children,
  mode = 'full-width',
  filled,
  ...rest
}) {
  const f = filled ?? mode === 'island';
  return /*#__PURE__*/React.createElement("div", _extends({
    className: __ds_scope.cx('mx-cl', 'mx-cl--' + mode, f && 'mx-cl--filled', className)
  }, rest), header != null && /*#__PURE__*/React.createElement("div", {
    className: "mx-cl__header"
  }, header), /*#__PURE__*/React.createElement("div", {
    className: "mx-cl__body"
  }, children));
}
Object.assign(__ds_scope, { CellList });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/cells/CellList.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Counter.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Pill-shaped numeric badge (unread count etc). */
function Counter({
  className,
  value,
  rounded,
  variant = 'primary',
  ...rest
}) {
  const v = rounded ? Intl.NumberFormat('en', {
    notation: 'compact'
  }).format(value) : value;
  return /*#__PURE__*/React.createElement("span", _extends({
    className: __ds_scope.cx('mx-counter mx-t-label-strong', 'mx-counter--' + variant, className)
  }, rest), v);
}
Object.assign(__ds_scope, { Counter });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Counter.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Spinner.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Loading indicator: 8-bar fade on iOS, conic ring on Android. */
function Spinner({
  className,
  size = 20,
  appearance = 'primary',
  style,
  ...rest
}) {
  const platform = __ds_scope.usePlatform();
  return /*#__PURE__*/React.createElement("span", _extends({
    role: "status",
    className: __ds_scope.cx('mx-spinner', 'mx-sp-' + appearance, className),
    style: style
  }, rest), platform === 'ios' ? /*#__PURE__*/React.createElement("span", {
    className: "mx-sp-ios",
    style: {
      width: size,
      height: size
    }
  }, Array.from({
    length: 8
  }, (_, i) => /*#__PURE__*/React.createElement("i", {
    key: i
  }))) : /*#__PURE__*/React.createElement("span", {
    className: "mx-sp-android",
    style: {
      width: size,
      height: size,
      display: 'block'
    }
  }));
}
Object.assign(__ds_scope, { Spinner });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Spinner.jsx", error: String((e && e.message) || e) }); }

// components/forms/Radio.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Radio({
  className,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: __ds_scope.cx('mx-radio', className),
    style: style
  }, /*#__PURE__*/React.createElement("input", _extends({}, rest, {
    type: "radio",
    className: "mx-radio__input"
  })), /*#__PURE__*/React.createElement("span", {
    className: "mx-radio__control"
  }));
}
Object.assign(__ds_scope, { Radio });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Radio.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Switch({
  className,
  style,
  ...rest
}) {
  const platform = __ds_scope.usePlatform();
  return /*#__PURE__*/React.createElement("span", {
    className: __ds_scope.cx('mx-switch', 'mx-switch--' + platform, className),
    style: style
  }, /*#__PURE__*/React.createElement("input", _extends({
    type: "checkbox",
    role: "switch",
    className: "mx-switch__input"
  }, rest)), /*#__PURE__*/React.createElement("span", {
    className: "mx-switch__toggle"
  }, /*#__PURE__*/React.createElement("span", {
    className: "mx-switch__thumb"
  })));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/forms/Textarea.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Textarea({
  className,
  style,
  mode = 'primary',
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: __ds_scope.cx('mx-ta', 'mx-ta--' + mode, rest.disabled && 'mx-ta--disabled', className),
    style: style
  }, /*#__PURE__*/React.createElement("textarea", _extends({
    className: "mx-textfield mx-ta__el mx-t-body"
  }, rest)));
}
Object.assign(__ds_scope, { Textarea });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Textarea.jsx", error: String((e && e.message) || e) }); }

// components/layout/Container.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Container({
  className,
  fullWidth,
  as: Comp = 'div',
  ...rest
}) {
  return /*#__PURE__*/React.createElement(Comp, _extends({
    className: __ds_scope.cx('mx-container', fullWidth && 'mx-container--full', className)
  }, rest));
}
Object.assign(__ds_scope, { Container });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/layout/Container.jsx", error: String((e && e.message) || e) }); }

// components/layout/EllipsisText.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function EllipsisText({
  className,
  maxLines = 1,
  style,
  as: Comp = 'span',
  ...rest
}) {
  return /*#__PURE__*/React.createElement(Comp, _extends({
    className: __ds_scope.cx('mx-ellipsis', maxLines > 1 ? 'mx-ellipsis--multi' : 'mx-ellipsis--single', className),
    style: {
      '--mx-lines': maxLines,
      ...style
    }
  }, rest));
}
Object.assign(__ds_scope, { EllipsisText });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/layout/EllipsisText.jsx", error: String((e && e.message) || e) }); }

// components/layout/Flex.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const px = v => typeof v === 'number' ? v + 'px' : v;
function Flex({
  className,
  display = 'flex',
  direction = 'row',
  align = 'flex-start',
  justify = 'start',
  wrap,
  gap,
  gapX,
  gapY,
  style,
  as: Comp = 'div',
  ...rest
}) {
  return /*#__PURE__*/React.createElement(Comp, _extends({
    className: __ds_scope.cx('mx-flex', className),
    style: {
      flexDirection: direction,
      justifyContent: justify,
      alignItems: align,
      flexWrap: wrap,
      ...style,
      display,
      '--mx-flex-gx': px(gapX ?? gap ?? 0),
      '--mx-flex-gy': px(gapY ?? gap ?? 0)
    }
  }, rest));
}
Object.assign(__ds_scope, { Flex });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/layout/Flex.jsx", error: String((e && e.message) || e) }); }

// components/layout/Grid.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const px = v => typeof v === 'number' ? v + 'px' : v;
function Grid({
  className,
  display = 'grid',
  align = 'start',
  justify = 'start',
  gap,
  gapX,
  gapY,
  cols,
  rows,
  style,
  as: Comp = 'div',
  ...rest
}) {
  return /*#__PURE__*/React.createElement(Comp, _extends({
    className: __ds_scope.cx('mx-grid', className),
    style: {
      justifyContent: justify,
      alignItems: align,
      ...style,
      display,
      '--mx-grid-gx': px(gapX ?? gap ?? 0),
      '--mx-grid-gy': px(gapY ?? gap ?? 0),
      '--mx-grid-cols': cols ?? 0,
      '--mx-grid-rows': rows ?? 0
    }
  }, rest));
}
Object.assign(__ds_scope, { Grid });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/layout/Grid.jsx", error: String((e && e.message) || e) }); }

// components/layout/Panel.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Panel({
  className,
  mode = 'primary',
  centeredX,
  centeredY,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: __ds_scope.cx('mx-panel', 'mx-panel--' + mode, centeredX && 'mx-panel--cx', centeredY && 'mx-panel--cy', className)
  }, rest));
}
Object.assign(__ds_scope, { Panel });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/layout/Panel.jsx", error: String((e && e.message) || e) }); }

// components/typography/Typography.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const mk = (map, def) => ({
  className,
  variant = def,
  as: Comp = 'span',
  ...rest
}) => /*#__PURE__*/React.createElement(Comp, _extends({
  className: __ds_scope.cx(map[variant] && 'mx-t-' + map[variant], className)
}, rest));
function TypographyDisplay({
  className,
  as: Comp = 'span',
  ...rest
}) {
  return /*#__PURE__*/React.createElement(Comp, _extends({
    className: __ds_scope.cx('mx-t-hero', className)
  }, rest));
}
const H = mk({
  'large-strong': 'header',
  medium: 'subheader',
  small: 'title'
}, 'large-strong');
function TypographyHeadline(p) {
  return /*#__PURE__*/React.createElement(H, p);
}
const T = mk({
  'large-strong': 'body-strong',
  medium: 'detail',
  'medium-strong': 'detail-strong',
  small: 'description',
  'small-strong': 'description-strong'
}, 'large-strong');
function TypographyTitle(p) {
  return /*#__PURE__*/React.createElement(T, p);
}
const B = mk({
  large: 'body',
  'large-strong': 'body-strong',
  medium: 'detail',
  'medium-strong': 'detail-strong',
  small: 'description',
  'small-strong': 'description-strong'
}, 'large-strong');
function TypographyBody(p) {
  return /*#__PURE__*/React.createElement(B, p);
}
const L = mk({
  large: 'label',
  'large-strong': 'label-strong',
  medium: 'tag',
  'medium-strong': 'tag-strong',
  small: 'note',
  'small-strong': 'note-strong'
}, 'large');
function TypographyLabel(p) {
  return /*#__PURE__*/React.createElement(L, p);
}
const A = mk({
  large: 'action-large',
  medium: 'action-medium',
  small: 'action-small',
  xsmall: 'action-xsmall'
}, 'large');
function TypographyAction(p) {
  return /*#__PURE__*/React.createElement(A, p);
}
function TypographyText({
  className,
  variant = 'body',
  color = 'inherit',
  as: Comp = 'span',
  ...rest
}) {
  return /*#__PURE__*/React.createElement(Comp, _extends({
    className: __ds_scope.cx('mx-t-' + variant, 'mx-c-' + color, className)
  }, rest));
}
const Typography = {
  Display: TypographyDisplay,
  Headline: TypographyHeadline,
  Title: TypographyTitle,
  Body: TypographyBody,
  Label: TypographyLabel,
  Text: TypographyText,
  Action: TypographyAction
};
Object.assign(__ds_scope, { TypographyDisplay, TypographyHeadline, TypographyTitle, TypographyBody, TypographyLabel, TypographyAction, TypographyText, Typography });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/typography/Typography.jsx", error: String((e && e.message) || e) }); }

// components/utility/Ripple.jsx
try { (() => {
/** Android-style press ripple. Place inside a position:relative, overflow:hidden parent. */
function Ripple({
  className
}) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const host = el.parentElement;
    const dot = el.firstChild;
    const down = e => {
      const r = host.getBoundingClientRect();
      dot.classList.remove('mx-ripple--active');
      void dot.offsetWidth;
      dot.style.top = e.clientY - r.top + 'px';
      dot.style.left = e.clientX - r.left + 'px';
      dot.classList.add('mx-ripple--active');
    };
    host.addEventListener('pointerdown', down);
    return () => host.removeEventListener('pointerdown', down);
  }, []);
  return /*#__PURE__*/React.createElement("span", {
    ref: ref,
    className: 'mx-ripple-host ' + (className || ''),
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("span", {
    className: "mx-ripple",
    onAnimationEnd: e => e.currentTarget.classList.remove('mx-ripple--active')
  }));
}
Object.assign(__ds_scope, { Ripple });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/utility/Ripple.jsx", error: String((e && e.message) || e) }); }

// components/buttons/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const spinnerSize = {
  xsmall: 16,
  small: 20,
  medium: 20,
  large: 24
};
const spinnerAppearance = {
  primary: 'contrast-static',
  destructive: 'contrast-static',
  overlay: 'contrast-static',
  secondary: 'primary',
  ghost: 'themed',
  'primary-contrast': 'primary-static',
  'secondary-contrast': 'primary-static'
};
const counterVariant = {
  primary: 'primary-contrast',
  secondary: 'static',
  ghost: 'static',
  'primary-contrast': 'static',
  'secondary-contrast': 'static',
  overlay: 'static-contrast',
  destructive: 'attention-contrast'
};
const typo = {
  xsmall: 'mx-t-action-small',
  small: 'mx-t-action-medium',
  medium: 'mx-t-action-large',
  large: 'mx-t-action-large'
};
function Button({
  className,
  size = 'medium',
  variant = 'primary',
  stretched = false,
  iconBefore,
  iconAfter,
  indicator,
  loading,
  disabled = false,
  children,
  as: Comp = 'button',
  onClick,
  ...rest
}) {
  const platform = __ds_scope.usePlatform();
  const inactive = disabled || loading;
  const withRipple = platform === 'android';
  const ind = React.isValidElement(indicator) && indicator.type === __ds_scope.Counter ? React.cloneElement(indicator, {
    variant: counterVariant[variant]
  }) : indicator;
  return /*#__PURE__*/React.createElement(Comp, _extends({
    className: __ds_scope.cx('mx-btn', 'mx-v-' + variant, 'mx-btn--' + size, loading && 'mx-b--loading', disabled && 'mx-b--disabled', stretched && 'mx-btn--stretched', !inactive && (withRipple ? 'mx-b--ripple' : 'mx-b--highlight'), className),
    disabled: Comp === 'button' ? disabled : undefined,
    "aria-busy": loading || undefined,
    onClick: inactive ? undefined : onClick
  }, Comp === 'button' ? {
    type: 'button'
  } : {}, rest), iconBefore != null && /*#__PURE__*/React.createElement("span", {
    className: "mx-btn__part mx-btn__before"
  }, iconBefore), loading && /*#__PURE__*/React.createElement("span", {
    className: "mx-btn__spinner"
  }, /*#__PURE__*/React.createElement(__ds_scope.Spinner, {
    size: spinnerSize[size],
    appearance: spinnerAppearance[variant]
  })), /*#__PURE__*/React.createElement("span", {
    className: __ds_scope.cx('mx-btn__content mx-ellipsis mx-ellipsis--single', typo[size])
  }, children), ind != null && /*#__PURE__*/React.createElement("span", {
    className: "mx-btn__part mx-btn__indicator"
  }, ind), iconAfter != null && /*#__PURE__*/React.createElement("span", {
    className: "mx-btn__part mx-btn__after"
  }, iconAfter), withRipple && !inactive && /*#__PURE__*/React.createElement(__ds_scope.Ripple, null));
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/buttons/Button.jsx", error: String((e && e.message) || e) }); }

// components/buttons/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const spinnerSize = {
  xsmall: 16,
  small: 20,
  medium: 20,
  large: 24
};
const spinnerAppearance = {
  primary: 'contrast-static',
  destructive: 'contrast-static',
  overlay: 'contrast-static',
  secondary: 'primary',
  ghost: 'primary',
  'primary-contrast': 'primary-static',
  'secondary-contrast': 'primary-static'
};
function IconButton({
  className,
  size = 'medium',
  variant = 'primary',
  loading,
  disabled,
  children,
  onClick,
  ...rest
}) {
  const platform = __ds_scope.usePlatform();
  const inactive = disabled || loading;
  const withRipple = platform === 'android';
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    className: __ds_scope.cx('mx-ibtn', 'mx-v-' + variant, 'mx-ibtn--' + size, loading && 'mx-b--loading', disabled && 'mx-b--disabled', !inactive && (withRipple ? 'mx-b--ripple' : 'mx-b--highlight'), className),
    disabled: disabled,
    onClick: inactive ? undefined : onClick
  }, rest), loading && /*#__PURE__*/React.createElement("span", {
    className: "mx-btn__spinner"
  }, /*#__PURE__*/React.createElement(__ds_scope.Spinner, {
    size: spinnerSize[size],
    appearance: spinnerAppearance[variant]
  })), /*#__PURE__*/React.createElement("span", {
    className: "mx-ibtn__content"
  }, children), withRipple && !inactive && /*#__PURE__*/React.createElement(__ds_scope.Ripple, null));
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/buttons/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/utility/SvgButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function SvgButton({
  className,
  type = 'button',
  ...rest
}) {
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    className: __ds_scope.cx('mx-reset mx-svgbtn', className)
  }, rest));
}
Object.assign(__ds_scope, { SvgButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/utility/SvgButton.jsx", error: String((e && e.message) || e) }); }

// components/avatar/Avatar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const AvatarCtx = React.createContext({
  size: 40
});
const onlineSize = s => s < 40 ? 'xs' : s < 52 ? 's' : s < 72 ? 'm' : 'l';
const textSize = s => s < 20 ? 6 : s < 28 ? 8 : s < 32 ? 10 : s < 36 ? 11 : s < 40 ? 13 : s < 48 ? 14 : s < 54 ? 17 : s < 64 ? 18 : s < 72 ? 21 : s < 88 ? 26 : 30;
const closeSize = s => s < 40 ? 12 : s < 54 ? 16 : s < 72 ? 20 : 24;
function AvatarContainer({
  className,
  style,
  children,
  overlay,
  rightTopCorner,
  rightBottomCorner,
  size = 40,
  form = 'circle',
  onlineStatus = false,
  ...rest
}) {
  const n = Number.isFinite(size) ? Math.min(200, Math.max(16, size)) : 40;
  const hasOnline = onlineStatus && form === 'circle' && n >= 24 && n <= 80;
  const showRB = !onlineStatus && n > 24 && rightBottomCorner != null;
  return /*#__PURE__*/React.createElement(AvatarCtx.Provider, {
    value: {
      size: n
    }
  }, /*#__PURE__*/React.createElement("div", _extends({
    className: __ds_scope.cx('mx-av', 'mx-av--' + form, hasOnline && 'mx-av--on-' + onlineSize(n), className),
    style: {
      '--mx-av-size': n + 'px',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    className: "mx-av__content"
  }, children, overlay != null && /*#__PURE__*/React.createElement("span", {
    className: "mx-av__overlay"
  }, overlay)), hasOnline && /*#__PURE__*/React.createElement("span", {
    className: "mx-av__online",
    "aria-hidden": "true"
  }), showRB && /*#__PURE__*/React.createElement("span", {
    className: "mx-av__rb"
  }, rightBottomCorner), rightTopCorner != null && /*#__PURE__*/React.createElement("span", {
    className: "mx-av__rt"
  }, rightTopCorner)));
}
function AvatarImage({
  className,
  src,
  alt = '',
  fallback,
  ...rest
}) {
  const [err, setErr] = React.useState(false);
  if (err && fallback) return fallback;
  return /*#__PURE__*/React.createElement("img", _extends({
    className: __ds_scope.cx('mx-av-img', className),
    src: src,
    alt: alt,
    onError: () => setErr(true)
  }, rest));
}
function AvatarText({
  className,
  children,
  gradient = 'red',
  ...rest
}) {
  const {
    size
  } = React.useContext(AvatarCtx);
  return /*#__PURE__*/React.createElement("span", _extends({
    className: __ds_scope.cx('mx-av-text', gradient !== 'custom' && 'mx-av-text--' + gradient, className)
  }, rest), /*#__PURE__*/React.createElement("span", {
    className: "mx-av-text__in",
    style: {
      fontSize: textSize(size)
    }
  }, children));
}
function AvatarIcon({
  className,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("span", _extends({
    className: __ds_scope.cx('mx-av-icon', className)
  }, rest));
}
function AvatarOverlay({
  className,
  onClick,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("span", _extends({
    className: __ds_scope.cx('mx-av-overlay', className),
    onClick: e => {
      e.preventDefault();
      onClick && onClick(e);
    }
  }, rest));
}
function AvatarCloseButton({
  className,
  onClick,
  ...rest
}) {
  const {
    size
  } = React.useContext(AvatarCtx);
  const s = closeSize(size);
  return /*#__PURE__*/React.createElement(__ds_scope.SvgButton, _extends({
    className: className,
    onClick: e => {
      e.preventDefault();
      onClick && onClick(e);
    }
  }, rest), /*#__PURE__*/React.createElement(__ds_scope.Icon20CloseFilled, {
    width: s,
    height: s
  }));
}
const Avatar = {
  Container: AvatarContainer,
  Image: AvatarImage,
  Text: AvatarText,
  Icon: AvatarIcon,
  Overlay: AvatarOverlay,
  CloseButton: AvatarCloseButton
};
Object.assign(__ds_scope, { AvatarContainer, AvatarImage, AvatarText, AvatarIcon, AvatarOverlay, AvatarCloseButton, Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/avatar/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/utility/ClearableInput.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Bare text input with an inline clear (×) button and optional character count. */
function ClearableInput({
  className,
  onChange,
  innerClassNames = {},
  withClearButton = true,
  disabled,
  count,
  value,
  defaultValue,
  inputClassName,
  ...rest
}) {
  const ref = React.useRef(null);
  const controlled = value !== undefined;
  const [empty, setEmpty] = React.useState(() => !defaultValue);
  const isEmpty = controlled ? value === '' || value == null : empty;
  const clear = () => {
    const el = ref.current;
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, '');
    el.dispatchEvent(new Event('input', {
      bubbles: true
    }));
    el.focus();
  };
  return /*#__PURE__*/React.createElement("span", {
    className: __ds_scope.cx('mx-clearable', className)
  }, /*#__PURE__*/React.createElement("input", _extends({
    ref: ref,
    className: __ds_scope.cx('mx-textfield', innerClassNames.input),
    disabled: disabled,
    value: value,
    defaultValue: defaultValue,
    onChange: e => {
      if (!controlled) setEmpty(e.currentTarget.value === '');
      onChange && onChange(e);
    }
  }, rest)), !isEmpty && !disabled && !!count && /*#__PURE__*/React.createElement("div", {
    className: __ds_scope.cx('mx-clearable__count mx-t-tag', innerClassNames.count)
  }, count), !isEmpty && !disabled && withClearButton && /*#__PURE__*/React.createElement(__ds_scope.SvgButton, {
    className: __ds_scope.cx('mx-clearable__btn', innerClassNames.clearButton),
    onMouseDown: e => e.preventDefault(),
    onClick: clear,
    "aria-label": "\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C"
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon16CloseIos, null)));
}
Object.assign(__ds_scope, { ClearableInput });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/utility/ClearableInput.jsx", error: String((e && e.message) || e) }); }

// components/cells/CellInput.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function CellInput({
  className,
  before,
  disabled,
  height = 'normal',
  surface = 'default',
  ...rest
}) {
  return /*#__PURE__*/React.createElement("label", {
    className: __ds_scope.cx('mx-ci', 'mx-cell--' + height, surface === 'island' && 'mx-cell--island', disabled && 'mx-ci--disabled', className)
  }, before != null && /*#__PURE__*/React.createElement("span", {
    className: "mx-ci__before mx-t-body-strong mx-ellipsis mx-ellipsis--single"
  }, before), /*#__PURE__*/React.createElement(__ds_scope.ClearableInput, _extends({
    className: "mx-ci__body",
    innerClassNames: {
      input: 'mx-ci__input mx-t-body',
      clearButton: 'mx-ci__clear'
    },
    type: "text",
    disabled: disabled
  }, rest)));
}
Object.assign(__ds_scope, { CellInput });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/cells/CellInput.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Input({
  className,
  style,
  iconBefore,
  iconAfter,
  size = 'large',
  mode = 'default',
  count,
  hint,
  withClearButton,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: className,
    style: style
  }, /*#__PURE__*/React.createElement("label", {
    className: __ds_scope.cx('mx-input', 'mx-input--' + mode, 'mx-input--' + size, rest.disabled && 'mx-input--disabled')
  }, iconBefore != null && /*#__PURE__*/React.createElement("div", {
    className: "mx-input__icon"
  }, iconBefore), /*#__PURE__*/React.createElement(__ds_scope.ClearableInput, _extends({
    className: "mx-input__body",
    withClearButton: withClearButton,
    count: count,
    innerClassNames: {
      input: __ds_scope.cx('mx-input__input', size === 'medium' ? 'mx-t-detail' : 'mx-t-body'),
      clearButton: 'mx-input__clear',
      count: 'mx-input__count'
    }
  }, rest)), iconAfter != null && /*#__PURE__*/React.createElement("div", {
    className: "mx-input__icon"
  }, iconAfter)), hint != null && /*#__PURE__*/React.createElement("div", {
    className: __ds_scope.cx('mx-input__hint mx-t-description', rest.disabled && 'mx-input__hint--disabled')
  }, hint));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/utility/Tappable.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Interactive surface: hover/pressed tint on iOS, ripple on Android. Used by CellSimple/CellAction. */
function Tappable({
  as: Comp = 'div',
  className,
  disabled,
  onClick,
  href,
  children,
  ...rest
}) {
  const platform = __ds_scope.usePlatform();
  const hasAction = !!(onClick || href || Comp === 'button' || Comp === 'a' || Comp === 'label');
  const withRipple = platform === 'android' && hasAction && !disabled;
  const btnProps = Comp === 'button' ? {
    type: 'button',
    disabled
  } : hasAction && Comp !== 'a' && Comp !== 'label' ? {
    role: 'button',
    tabIndex: disabled ? -1 : 0,
    'aria-disabled': disabled || undefined
  } : {};
  return /*#__PURE__*/React.createElement(Comp, _extends({
    className: __ds_scope.cx('mx-reset mx-tappable', hasAction && 'mx-tappable--interactive', disabled && 'mx-tappable--disabled', withRipple ? 'mx-tappable--ripple' : 'mx-tappable--highlight', className),
    onClick: disabled ? undefined : onClick,
    href: href
  }, btnProps, rest), children, withRipple && /*#__PURE__*/React.createElement(__ds_scope.Ripple, null));
}
Object.assign(__ds_scope, { Tappable });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/utility/Tappable.jsx", error: String((e && e.message) || e) }); }

// components/cells/CellAction.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function CellAction({
  className,
  before,
  children,
  mode = 'primary',
  surface = 'default',
  height = 'normal',
  showChevron = false,
  disabled,
  ...rest
}) {
  return /*#__PURE__*/React.createElement(__ds_scope.Tappable, _extends({
    as: "button",
    disabled: disabled,
    className: __ds_scope.cx('mx-cell', 'mx-ca--' + mode, 'mx-cell--' + height, surface === 'island' && 'mx-cell--island', disabled && 'mx-ca--disabled', className)
  }, rest), before != null && /*#__PURE__*/React.createElement("span", {
    className: "mx-cell__before"
  }, before), /*#__PURE__*/React.createElement("span", {
    className: "mx-ca__content mx-t-action-medium"
  }, children), showChevron && /*#__PURE__*/React.createElement(__ds_scope.Icon16Chevron, {
    className: "mx-cell__chevron"
  }));
}
Object.assign(__ds_scope, { CellAction });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/cells/CellAction.jsx", error: String((e && e.message) || e) }); }

// components/cells/CellSimple.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function CellSimple({
  className,
  title,
  subtitle,
  overline,
  before,
  after,
  children,
  link,
  separator,
  showChevron = false,
  height = 'normal',
  surface = 'default',
  subtitleMode = 'secondary',
  disabled = false,
  as = 'div',
  ...rest
}) {
  return /*#__PURE__*/React.createElement(__ds_scope.Tappable, _extends({
    as: as,
    disabled: disabled,
    className: __ds_scope.cx('mx-cell mx-cs', 'mx-cell--' + height, 'mx-cs--sub-' + subtitleMode, surface === 'island' && 'mx-cell--island', disabled && 'mx-cs--disabled', separator && 'mx-cs--separator', className)
  }, rest), before != null && /*#__PURE__*/React.createElement("div", {
    className: "mx-cell__before"
  }, before), /*#__PURE__*/React.createElement("div", {
    className: "mx-cs__content"
  }, overline != null && /*#__PURE__*/React.createElement("div", {
    className: "mx-cs__overline mx-t-description"
  }, overline), title != null && /*#__PURE__*/React.createElement("div", {
    className: "mx-cs__title mx-t-body-strong"
  }, title), subtitle != null && /*#__PURE__*/React.createElement("div", {
    className: "mx-cs__subtitle mx-t-description"
  }, subtitle), children, link && /*#__PURE__*/React.createElement("a", {
    className: "mx-cs__link mx-t-description",
    href: link,
    target: "_blank",
    rel: "noreferrer"
  }, link)), (after != null || showChevron) && /*#__PURE__*/React.createElement("div", {
    className: "mx-cell__after"
  }, after, showChevron && /*#__PURE__*/React.createElement(__ds_scope.Icon16Chevron, {
    className: "mx-cell__chevron"
  })));
}
Object.assign(__ds_scope, { CellSimple });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/cells/CellSimple.jsx", error: String((e && e.message) || e) }); }

// ui_kits/mini-app/ChatsScreen.jsx
try { (() => {
const CHATS = [{
  n: 'Анна Петрова',
  i: 'АП',
  g: 'red',
  m: 'Увидимся завтра в 10!',
  t: '12:41',
  c: 2,
  on: true
}, {
  n: 'Команда дизайна',
  i: 'КД',
  g: 'purple',
  m: 'Олег: макеты залил в папку',
  t: '11:03',
  c: 14,
  sq: true
}, {
  n: 'Новости MAX',
  i: 'MX',
  g: 'blue',
  m: 'Мини-приложения теперь поддерживают…',
  t: 'Вчера',
  c: 1200,
  mute: true,
  sq: true
}, {
  n: 'Сергей Ким',
  i: 'СК',
  g: 'green',
  m: 'Спасибо!',
  t: 'Пн',
  on: true
}, {
  n: 'Мама',
  i: 'М',
  g: 'orange',
  m: 'Позвони, как освободишься',
  t: 'Вс'
}];
function ChatsScreen({
  go
}) {
  const {
    Panel,
    Container,
    Input,
    CellList,
    CellSimple,
    Avatar,
    Counter,
    Typography,
    Icon16SearchOutline,
    Spinner,
    Flex
  } = window.MAXUIDesignSystem_b9d019;
  const [q, setQ] = React.useState('');
  const list = CHATS.filter(c => c.n.toLowerCase().includes(q.toLowerCase()));
  return /*#__PURE__*/React.createElement(Panel, {
    mode: "primary"
  }, /*#__PURE__*/React.createElement(NavBar, {
    title: "\u0427\u0430\u0442\u044B",
    onBack: () => go('profile')
  }), /*#__PURE__*/React.createElement(Container, {
    style: {
      paddingBottom: 8,
      background: 'var(--background-surface)'
    }
  }, /*#__PURE__*/React.createElement(Input, {
    size: "medium",
    mode: "contrast",
    iconBefore: /*#__PURE__*/React.createElement(Icon16SearchOutline, null),
    placeholder: "\u041F\u043E\u0438\u0441\u043A",
    value: q,
    onChange: e => setQ(e.target.value),
    withClearButton: true
  })), /*#__PURE__*/React.createElement(CellList, null, list.map(c => /*#__PURE__*/React.createElement(CellSimple, {
    key: c.n,
    onClick: () => {},
    before: /*#__PURE__*/React.createElement(Avatar.Container, {
      size: 48,
      form: c.sq ? 'squircle' : 'circle',
      onlineStatus: c.on
    }, /*#__PURE__*/React.createElement(Avatar.Text, {
      gradient: c.g
    }, c.i)),
    title: c.n,
    subtitle: c.m,
    subtitleMode: "tertiary",
    after: /*#__PURE__*/React.createElement(Flex, {
      direction: "column",
      align: "flex-end",
      gap: 4
    }, /*#__PURE__*/React.createElement(Typography.Text, {
      variant: "label",
      color: "tertiary"
    }, c.t), c.c ? /*#__PURE__*/React.createElement(Counter, {
      value: c.c,
      rounded: true,
      variant: c.mute ? 'mute' : 'primary'
    }) : /*#__PURE__*/React.createElement("span", {
      style: {
        height: 20
      }
    }))
  })), list.length === 0 && /*#__PURE__*/React.createElement(Flex, {
    justify: "center",
    style: {
      padding: 32
    }
  }, /*#__PURE__*/React.createElement(Typography.Text, {
    variant: "detail",
    color: "tertiary"
  }, "\u041D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E"))), /*#__PURE__*/React.createElement(Flex, {
    justify: "center",
    style: {
      padding: 16
    }
  }, /*#__PURE__*/React.createElement(Spinner, {
    size: 24
  })));
}
window.ChatsScreen = ChatsScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/mini-app/ChatsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/mini-app/FeedbackScreen.jsx
try { (() => {
function FeedbackScreen({
  go
}) {
  const {
    Panel,
    Container,
    Flex,
    CellList,
    CellHeader,
    CellInput,
    Textarea,
    Button,
    Typography,
    Avatar
  } = window.MAXUIDesignSystem_b9d019;
  const [state, setState] = React.useState('idle');
  const [text, setText] = React.useState('');
  const send = () => {
    setState('loading');
    setTimeout(() => setState('done'), 1200);
  };
  if (state === 'done') return /*#__PURE__*/React.createElement(Panel, {
    mode: "secondary",
    centeredX: true,
    centeredY: true
  }, /*#__PURE__*/React.createElement(Flex, {
    direction: "column",
    align: "center",
    gap: 16,
    style: {
      padding: 24,
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement(Avatar.Container, {
    size: 72
  }, /*#__PURE__*/React.createElement(Avatar.Text, {
    gradient: "green"
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "check",
    size: 36,
    style: {
      display: 'block',
      margin: '0 auto'
    }
  }))), /*#__PURE__*/React.createElement(Typography.Headline, {
    variant: "medium"
  }, "\u0421\u043F\u0430\u0441\u0438\u0431\u043E!"), /*#__PURE__*/React.createElement(Typography.Text, {
    variant: "detail",
    color: "secondary"
  }, "\u041C\u044B \u043F\u043E\u043B\u0443\u0447\u0438\u043B\u0438 \u0432\u0430\u0448\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435 \u0438 \u043E\u0442\u0432\u0435\u0442\u0438\u043C \u0432 \u0442\u0435\u0447\u0435\u043D\u0438\u0435 \u0434\u043D\u044F."), /*#__PURE__*/React.createElement(Button, {
    size: "large",
    stretched: true,
    onClick: () => go('profile')
  }, "\u0413\u043E\u0442\u043E\u0432\u043E")));
  return /*#__PURE__*/React.createElement(Panel, {
    mode: "secondary"
  }, /*#__PURE__*/React.createElement(NavBar, {
    title: "\u041E\u0431\u0440\u0430\u0442\u043D\u0430\u044F \u0441\u0432\u044F\u0437\u044C",
    onBack: () => go('profile')
  }), /*#__PURE__*/React.createElement(Flex, {
    direction: "column",
    gap: 20,
    style: {
      paddingTop: 4
    }
  }, /*#__PURE__*/React.createElement(CellList, {
    mode: "island",
    header: /*#__PURE__*/React.createElement(CellHeader, null, "\u041A\u043E\u043D\u0442\u0430\u043A\u0442\u044B")
  }, /*#__PURE__*/React.createElement(CellInput, {
    before: "\u0418\u043C\u044F",
    defaultValue: "\u0418\u0432\u0430\u043D"
  }), /*#__PURE__*/React.createElement(CellInput, {
    before: "\u042D\u043B. \u043F\u043E\u0447\u0442\u0430",
    placeholder: "name@mail.ru",
    type: "email"
  })), /*#__PURE__*/React.createElement(Container, null, /*#__PURE__*/React.createElement(CellHeader, {
    fullWidth: true
  }, "\u0421\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435"), /*#__PURE__*/React.createElement(Textarea, {
    rows: 5,
    placeholder: "\u041E\u043F\u0438\u0448\u0438\u0442\u0435, \u0447\u0442\u043E \u043F\u0440\u043E\u0438\u0437\u043E\u0448\u043B\u043E",
    value: text,
    onChange: e => setText(e.target.value)
  })), /*#__PURE__*/React.createElement(Container, null, /*#__PURE__*/React.createElement(Button, {
    size: "large",
    stretched: true,
    loading: state === 'loading',
    disabled: !text.trim(),
    onClick: send
  }, "\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C"))));
}
window.FeedbackScreen = FeedbackScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/mini-app/FeedbackScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/mini-app/ProfileScreen.jsx
try { (() => {
function ProfileScreen({
  go
}) {
  const {
    Panel,
    Container,
    Flex,
    Avatar,
    Typography,
    Button,
    Grid,
    CellList,
    CellHeader,
    CellSimple,
    CellAction
  } = window.MAXUIDesignSystem_b9d019;
  return /*#__PURE__*/React.createElement(Panel, {
    mode: "secondary"
  }, /*#__PURE__*/React.createElement(NavBar, {
    title: "",
    after: /*#__PURE__*/React.createElement(IconButtonSettings, {
      go: go
    })
  }), /*#__PURE__*/React.createElement(Container, null, /*#__PURE__*/React.createElement(Flex, {
    direction: "column",
    align: "center",
    gap: 12,
    style: {
      padding: '8px 0 20px'
    }
  }, /*#__PURE__*/React.createElement(Avatar.Container, {
    size: 96,
    form: "squircle"
  }, /*#__PURE__*/React.createElement(Avatar.Text, {
    gradient: "blue"
  }, "\u0418\u0418")), /*#__PURE__*/React.createElement(Flex, {
    direction: "column",
    align: "center",
    gap: 4
  }, /*#__PURE__*/React.createElement(Typography.Headline, null, "\u0418\u0432\u0430\u043D \u0418\u0432\u0430\u043D\u043E\u0432"), /*#__PURE__*/React.createElement(Typography.Text, {
    variant: "description",
    color: "tertiary"
  }, "+7 900 123-45-67 \xB7 @ivanov"))), /*#__PURE__*/React.createElement(Grid, {
    cols: 3,
    gap: 8,
    style: {
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary-contrast",
    size: "medium",
    style: {
      flexDirection: 'column',
      height: 64,
      gap: 4,
      padding: 8
    },
    onClick: () => go('chats')
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "message-circle"
  })), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary-contrast",
    size: "medium",
    style: {
      height: 64,
      padding: 8
    }
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "phone"
  })), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary-contrast",
    size: "medium",
    style: {
      height: 64,
      padding: 8
    }
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "share-2"
  })))), /*#__PURE__*/React.createElement(Flex, {
    direction: "column",
    gap: 20
  }, /*#__PURE__*/React.createElement(CellList, {
    mode: "island",
    header: /*#__PURE__*/React.createElement(CellHeader, null, "\u0418\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0438\u044F")
  }, /*#__PURE__*/React.createElement(CellSimple, {
    overline: "\u041E \u0441\u0435\u0431\u0435",
    title: "\u0414\u0438\u0437\u0430\u0439\u043D\u0435\u0440 \u0438\u043D\u0442\u0435\u0440\u0444\u0435\u0439\u0441\u043E\u0432"
  }), /*#__PURE__*/React.createElement(CellSimple, {
    overline: "\u0421\u0441\u044B\u043B\u043A\u0430",
    link: "https://max.ru/ivanov",
    separator: true
  })), /*#__PURE__*/React.createElement(CellList, {
    mode: "island"
  }, /*#__PURE__*/React.createElement(CellSimple, {
    before: /*#__PURE__*/React.createElement(CellIcon, {
      name: "bell",
      bg: "rgb(255 48 60)"
    }),
    title: "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438",
    showChevron: true,
    onClick: () => go('settings')
  }), /*#__PURE__*/React.createElement(CellSimple, {
    before: /*#__PURE__*/React.createElement(CellIcon, {
      name: "message-square-text",
      bg: "rgb(26 190 67)"
    }),
    title: "\u041E\u0431\u0440\u0430\u0442\u043D\u0430\u044F \u0441\u0432\u044F\u0437\u044C",
    showChevron: true,
    onClick: () => go('feedback'),
    separator: true
  })), /*#__PURE__*/React.createElement(CellList, {
    mode: "island"
  }, /*#__PURE__*/React.createElement(CellAction, {
    mode: "destructive"
  }, "\u0412\u044B\u0439\u0442\u0438 \u0438\u0437 \u0430\u043A\u043A\u0430\u0443\u043D\u0442\u0430"))), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 24
    }
  }));
}
function IconButtonSettings({
  go
}) {
  const {
    IconButton
  } = window.MAXUIDesignSystem_b9d019;
  return /*#__PURE__*/React.createElement(IconButton, {
    variant: "ghost",
    size: "small",
    "aria-label": "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438",
    onClick: () => go('settings')
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--icon-themed)',
      display: 'flex'
    }
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "settings"
  })));
}
window.ProfileScreen = ProfileScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/mini-app/ProfileScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/mini-app/SettingsScreen.jsx
try { (() => {
function SettingsScreen({
  go,
  scheme,
  setScheme
}) {
  const {
    Panel,
    Flex,
    CellList,
    CellHeader,
    CellSimple,
    Switch,
    Radio,
    Counter
  } = window.MAXUIDesignSystem_b9d019;
  return /*#__PURE__*/React.createElement(Panel, {
    mode: "secondary"
  }, /*#__PURE__*/React.createElement(NavBar, {
    title: "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438",
    onBack: () => go('profile')
  }), /*#__PURE__*/React.createElement(Flex, {
    direction: "column",
    gap: 20,
    style: {
      paddingTop: 4,
      paddingBottom: 24
    }
  }, /*#__PURE__*/React.createElement(CellList, {
    mode: "island",
    header: /*#__PURE__*/React.createElement(CellHeader, null, "\u0423\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u044F")
  }, /*#__PURE__*/React.createElement(CellSimple, {
    as: "label",
    title: "\u041B\u0438\u0447\u043D\u044B\u0435 \u0447\u0430\u0442\u044B",
    subtitle: "\u041F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0442\u044C \u0442\u0435\u043A\u0441\u0442 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F",
    after: /*#__PURE__*/React.createElement(Switch, {
      defaultChecked: true
    })
  }), /*#__PURE__*/React.createElement(CellSimple, {
    as: "label",
    title: "\u0413\u0440\u0443\u043F\u043F\u044B",
    after: /*#__PURE__*/React.createElement(Switch, {
      defaultChecked: true
    }),
    separator: true
  }), /*#__PURE__*/React.createElement(CellSimple, {
    as: "label",
    title: "\u041A\u0430\u043D\u0430\u043B\u044B",
    after: /*#__PURE__*/React.createElement(Switch, null),
    separator: true
  }), /*#__PURE__*/React.createElement(CellSimple, {
    title: "\u0417\u0432\u0443\u043A",
    after: /*#__PURE__*/React.createElement("span", {
      className: "mx-t-body mx-c-tertiary"
    }, "\u041D\u043E\u0442\u0430"),
    showChevron: true,
    onClick: () => {},
    separator: true
  })), /*#__PURE__*/React.createElement(CellList, {
    mode: "island",
    header: /*#__PURE__*/React.createElement(CellHeader, null, "\u0422\u0435\u043C\u0430")
  }, /*#__PURE__*/React.createElement(CellSimple, {
    as: "label",
    title: "\u0421\u0432\u0435\u0442\u043B\u0430\u044F",
    after: /*#__PURE__*/React.createElement(Radio, {
      name: "theme",
      checked: scheme === 'light',
      onChange: () => setScheme('light')
    })
  }), /*#__PURE__*/React.createElement(CellSimple, {
    as: "label",
    title: "\u0422\u0451\u043C\u043D\u0430\u044F",
    after: /*#__PURE__*/React.createElement(Radio, {
      name: "theme",
      checked: scheme === 'dark',
      onChange: () => setScheme('dark')
    }),
    separator: true
  })), /*#__PURE__*/React.createElement(CellList, {
    mode: "island",
    header: /*#__PURE__*/React.createElement(CellHeader, null, "\u0414\u0430\u043D\u043D\u044B\u0435")
  }, /*#__PURE__*/React.createElement(CellSimple, {
    title: "\u0418\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u043D\u0438\u0435 \u043F\u0430\u043C\u044F\u0442\u0438",
    subtitle: "1,2 \u0413\u0411",
    showChevron: true,
    onClick: () => {}
  }), /*#__PURE__*/React.createElement(CellSimple, {
    title: "\u0410\u043A\u0442\u0438\u0432\u043D\u044B\u0435 \u0441\u0435\u0430\u043D\u0441\u044B",
    after: /*#__PURE__*/React.createElement(Counter, {
      value: 3,
      variant: "mute"
    }),
    showChevron: true,
    onClick: () => {},
    separator: true
  }), /*#__PURE__*/React.createElement(CellSimple, {
    title: "\u0410\u0432\u0442\u043E\u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0430 \u043C\u0435\u0434\u0438\u0430",
    subtitle: "\u041D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E \u0432 \u044D\u0442\u043E\u0439 \u0432\u0435\u0440\u0441\u0438\u0438",
    disabled: true,
    separator: true
  }))));
}
window.SettingsScreen = SettingsScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/mini-app/SettingsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/mini-app/Shared.jsx
try { (() => {
const {
  Avatar,
  Button,
  IconButton,
  Typography,
  Counter,
  Icon16Chevron,
  Icon24CloseAndroid
} = window.MAXUIDesignSystem_b9d019;

// Lucide (CDN) used as a stand-in icon set — max-ui ships only 6 glyphs. Rendered via CSS mask so it takes currentColor.
function LIcon({
  name,
  size = 24,
  style
}) {
  const url = 'url(https://unpkg.com/lucide-static@0.469.0/icons/' + name + '.svg)';
  return /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      display: 'inline-block',
      width: size,
      height: size,
      backgroundColor: 'currentColor',
      WebkitMask: url + ' center/contain no-repeat',
      mask: url + ' center/contain no-repeat',
      flexShrink: 0,
      ...style
    }
  });
}
function NavBar({
  title,
  onBack,
  after
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      padding: '8px 4px',
      minHeight: 56,
      boxSizing: 'border-box',
      background: 'var(--background-surface)',
      position: 'sticky',
      top: 0,
      zIndex: 2
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 52,
      display: 'flex',
      justifyContent: 'center'
    }
  }, onBack && /*#__PURE__*/React.createElement(IconButton, {
    variant: "ghost",
    size: "small",
    "aria-label": "\u041D\u0430\u0437\u0430\u0434",
    onClick: onBack
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--icon-themed)',
      display: 'flex',
      transform: 'scaleX(-1)'
    }
  }, /*#__PURE__*/React.createElement(Icon16Chevron, {
    width: 15,
    height: 20
  })))), /*#__PURE__*/React.createElement(Typography.Headline, {
    variant: "small",
    style: {
      flex: 1,
      textAlign: 'center'
    }
  }, title), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 52,
      display: 'flex',
      justifyContent: 'center'
    }
  }, after));
}
function CellIcon({
  name,
  bg
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      width: 32,
      height: 32,
      borderRadius: 10,
      background: bg,
      color: '#fff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: name,
    size: 18
  }));
}
Object.assign(window, {
  LIcon,
  NavBar,
  CellIcon
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/mini-app/Shared.jsx", error: String((e && e.message) || e) }); }

__ds_ns.AvatarContainer = __ds_scope.AvatarContainer;

__ds_ns.AvatarImage = __ds_scope.AvatarImage;

__ds_ns.AvatarText = __ds_scope.AvatarText;

__ds_ns.AvatarIcon = __ds_scope.AvatarIcon;

__ds_ns.AvatarOverlay = __ds_scope.AvatarOverlay;

__ds_ns.AvatarCloseButton = __ds_scope.AvatarCloseButton;

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.CellAction = __ds_scope.CellAction;

__ds_ns.CellHeader = __ds_scope.CellHeader;

__ds_ns.CellInput = __ds_scope.CellInput;

__ds_ns.CellList = __ds_scope.CellList;

__ds_ns.CellSimple = __ds_scope.CellSimple;

__ds_ns.Icon16Chevron = __ds_scope.Icon16Chevron;

__ds_ns.Icon16CloseIos = __ds_scope.Icon16CloseIos;

__ds_ns.Icon16SearchOutline = __ds_scope.Icon16SearchOutline;

__ds_ns.Icon20CloseAndroid = __ds_scope.Icon20CloseAndroid;

__ds_ns.Icon20CloseFilled = __ds_scope.Icon20CloseFilled;

__ds_ns.Icon24CloseAndroid = __ds_scope.Icon24CloseAndroid;

__ds_ns.Icons = __ds_scope.Icons;

__ds_ns.MaxUIContext = __ds_scope.MaxUIContext;

__ds_ns.MaxUI = __ds_scope.MaxUI;

__ds_ns.Counter = __ds_scope.Counter;

__ds_ns.Spinner = __ds_scope.Spinner;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Radio = __ds_scope.Radio;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.Textarea = __ds_scope.Textarea;

__ds_ns.Container = __ds_scope.Container;

__ds_ns.EllipsisText = __ds_scope.EllipsisText;

__ds_ns.Flex = __ds_scope.Flex;

__ds_ns.Grid = __ds_scope.Grid;

__ds_ns.Panel = __ds_scope.Panel;

__ds_ns.TypographyDisplay = __ds_scope.TypographyDisplay;

__ds_ns.TypographyHeadline = __ds_scope.TypographyHeadline;

__ds_ns.TypographyTitle = __ds_scope.TypographyTitle;

__ds_ns.TypographyBody = __ds_scope.TypographyBody;

__ds_ns.TypographyLabel = __ds_scope.TypographyLabel;

__ds_ns.TypographyAction = __ds_scope.TypographyAction;

__ds_ns.TypographyText = __ds_scope.TypographyText;

__ds_ns.Typography = __ds_scope.Typography;

__ds_ns.ClearableInput = __ds_scope.ClearableInput;

__ds_ns.Ripple = __ds_scope.Ripple;

__ds_ns.SvgButton = __ds_scope.SvgButton;

__ds_ns.Tappable = __ds_scope.Tappable;

})();
