if (!RedactorPlugins) var RedactorPlugins = {};

/**
 * This plugin makes liberally use of dumb monkey patching to adjust Redactor for our needs. In
 * general this is a collection of methods whose side-effects cannot be prevented in any other
 * way or a work-around would cause a giant pile of boilerplates.
 * 
 * ATTENTION!
 * This plugin partially contains code taken from Redactor, Copyright (c) 2009-2014 Imperavi LLC.
 * Under no circumstances you are allowed to use potions or entire code blocks for use anywhere
 * except when directly working with WoltLab Community Framework.
 * 
 * @author	Alexander Ebert
 * @copyright	2001-2014 WoltLab GmbH, 2009-2014 Imperavi LLC.
 * @license	http://imperavi.com/redactor/license/
 */
RedactorPlugins.wmonkeypatch = function() {
	"use strict";
	
	return {
		/**
		 * saved selection range
		 * @var	range
		 */
		_range: null,
		
		/**
		 * Initializes the RedactorPlugins.wmonkeypatch plugin.
		 */
		init: function() {
			// module overrides
			this.wmonkeypatch.button();
			this.wmonkeypatch.caret();
			this.wmonkeypatch.clean();
			this.wmonkeypatch.code();
			this.wmonkeypatch.dropdown();
			this.wmonkeypatch.image();
			this.wmonkeypatch.insert();
			this.wmonkeypatch.keydown();
			this.wmonkeypatch.link();
			this.wmonkeypatch.modal();
			this.wmonkeypatch.paste();
			this.wmonkeypatch.observe();
			this.wmonkeypatch.utils();
			
			// templates
			this.wmonkeypatch.rebuildTemplates();
			
			// events and callbacks
			this.wmonkeypatch.bindEvents();
			
			// browser-specific fixes
			this.wmonkeypatch.fixWebKit();
		},
		
		/**
		 * Setups event listeners and callbacks.
		 */
		bindEvents: function() {
			var $identifier = this.$textarea.wcfIdentify();
			
			// keydown
			this.wutil.setOption('keydownCallback', function(event) {
				var $data = {
					cancel: false,
					event: event
				};
				
				WCF.System.Event.fireEvent('com.woltlab.wcf.redactor', 'keydown_' + $identifier, $data);
				
				return ($data.cancel ? false : true);
			});
			
			// keyup
			this.wutil.setOption('keyupCallback', function(event) {
				var $data = {
					cancel: false,
					event: event
				};
				
				WCF.System.Event.fireEvent('com.woltlab.wcf.redactor', 'keyup_' + $identifier, $data);
				
				return ($data.cancel ? false : true);
			});
			
			// buttons response
			if (this.opts.activeButtons) {
				this.$editor.off('mouseup.redactor keyup.redactor focus.redactor');
				
				this.$editor.on('mouseup.redactor keyup.redactor focus.redactor', $.proxy(this.observe.buttons, this));
				this.$editor.on('keyup.redactor', $.proxy(this.keyup.init, this));
			}
			
			this.$editor.on('blur.wredactor', (function() {
				var $selection = window.getSelection();
				if ($selection.rangeCount) {
					this.wmonkeypatch._range = $selection.getRangeAt(0);
				}
			}).bind(this));
		},
		
		/**
		 * Partially overwrites the 'button' module.
		 * 
		 *  - consistent display of dropdowns
		 */
		button: function() {
			// button.addDropdown
			var $mpAddDropdown = this.button.addDropdown;
			this.button.addDropdown = (function($btn, dropdown) {
				var $dropdown = $mpAddDropdown.call(this, $btn, dropdown);
				
				if (!dropdown) {
					$dropdown.addClass('dropdownMenu');
				}
				
				return $dropdown;
			}).bind(this);
		},
		
		/**
		 * Partially overwrites the 'caret' module.
		 * 
		 *  - resolves a selection issue if start === end when setting the caret offsets
		 */
		caret: function() {
			this.caret.setOffset = (function(start, end)
			{
				if (typeof end == 'undefined') end = start;
				if (!this.focus.isFocused()) this.focus.setStart();

				var range = document.createRange();
				var sel = document.getSelection();
				var node, offset = 0;
				var walker = document.createTreeWalker(this.$editor[0], NodeFilter.SHOW_TEXT, null, null);

				while (node = walker.nextNode())
				{
					offset += node.nodeValue.length;
					// WoltLab fix below, remove this method once the issue has been resolved by Imperavi
					if (offset > start || (start === end && offset === start))
					//if (offset > start)
					{
						range.setStart(node, node.nodeValue.length + start - offset);
						start = Infinity;
					}

					if (offset >= end)
					{
						range.setEnd(node, node.nodeValue.length + end - offset);
						break;
					}
				}

				sel.removeAllRanges();
				sel.addRange(range);
			}).bind(this);
		},
		
		/**
		 * Partially overwrites the 'clean' module.
		 * 
		 *  - convert <div> to <p> during paste
		 */
		clean: function() {
			// clean.onPaste
			var $mpOnPaste = this.clean.onPaste;
			this.clean.onPaste = (function(html, setMode) {
				this.opts.replaceDivs = true;
				
				html = $mpOnPaste.call(this, html, setMode);
				
				this.opts.replaceDivs = false;
				
				return html;
			}).bind(this);
			
			// clean.setVerified
			// TODO: remove this once the escape bug has been fixed by Imperavi
			this.clean.setVerified = (function(html) {
				if (this.utils.browser('msie')) return html;
				
				html = html.replace(new RegExp('<img(.*?[^>])>', 'gi'), '<img$1 data-verified="redactor">');
				html = html.replace(new RegExp('<span(.*?)>', 'gi'), '<span$1 data-verified="redactor">');
				
				var matches = html.match(new RegExp('<(span|img)(.*?)style="(.*?)"(.*?[^>])>', 'gi'));
				if (matches) {
					var len = matches.length;
					for (var i = 0; i < len; i++) {
						var newTag = matches[i].replace(/style="(.*?)"/i, 'style="$1" rel="$1"');
						html = html.replace(new RegExp(WCF.String.escapeRegExp(matches[i]), 'gi'), newTag);
					}
				}
				
				return html;
			}).bind(this);
		},
		
		/**
		 * Partially overwrites the 'code' module.
		 * 
		 *  - Redactor internally caches the code and does not flush to textarea if it was not changed, force flushing
		 */
		code: function() {
			// code.startSync
			var $mpStartSync = this.code.startSync;
			this.code.startSync = (function() {
				// the editor internally caches if it needs to sync, thus we need to reset the internal cache to force a sync
				this.code.syncCode = undefined;
				
				$mpStartSync.call(this);
			}).bind(this);
		},
		
		/**
		 * Partially overwrites the 'dropdown' module.
		 * 
		 *  - emulate WCF-like dropdowns.
		 */
		dropdown: function() {
			// dropdown.build
			this.dropdown.build = (function(name, $dropdown, dropdownObject) {
				$dropdown.addClass('dropdownMenu');
				
				$.each(dropdownObject, (function(btnName, btnObject) {
					if (btnName == 'dropdownDivider') {
						$('<li class="dropdownDivider" />').appendTo($dropdown);
					}
					else {
						var $listItem = $('<li />');
						var $item = $('<a href="#" class="redactor-dropdown-' + btnName + '">' + btnObject.title + '</a>');
						
						$item.on('click', $.proxy(function(e) {
							var type = 'func';
							var callback = btnObject.func;
							if (btnObject.command) {
								type = 'command';
								callback = btnObject.command;
							}
							else if (btnObject.dropdown) {
								type = 'dropdown';
								callback = btnObject.dropdown;
							}
							
							this.button.onClick(e, btnName, type, callback);
							
						}, this));
						
						$item.appendTo($listItem);
						$listItem.appendTo($dropdown);
					}
				}).bind(this));
			}).bind(this);
			
			// dropdown.show
			var $mpShow = this.dropdown.show;
			this.dropdown.show = $.proxy(function(e, key) {
				var $dropdown = this.button.get(key).data('dropdown');
				$fixDropdown($dropdown);
				
				$mpShow.call(this, e, key);
				
				$dropdown.off('mouseover mouseout');
			}, this);
			
			// fix existing dropdowns
			var $fixDropdown = function(dropdown) {
				if (dropdown.hasClass('dropdownMenu')) {
					return;
				}
				
				dropdown.addClass('dropdownMenu');
				var $items = dropdown.children('a').detach();
				for (var $i = 0; $i < $items.length; $i++) {
					var $item = $('<li />').appendTo(dropdown);
					$item.append($items[$i]);
				}
			};
		},
		
		/**
		 * Partially overwrites the 'image' module.
		 * 
		 *  - WCF-like dialog behavior
		 */
		image: function() {
			// image.setEditable
			var $mpSetEditable = this.image.setEditable;
			this.image.setEditable = (function($image) {
				if (!$image.hasClass('smiley')) {
					$mpSetEditable.call(this, $image);
				}
			}).bind(this);
			
			// image.show
			this.image.show = (function() {
				this.modal.load('image', this.lang.get('image'), 0);
				var $button = this.modal.createActionButton(this.lang.get('insert'));
				$button.click($.proxy(this.wbutton._insertImage, this));
				
				this.selection.save();
				this.modal.show();
			}).bind(this);
			
			// image.showEdit
			this.image.showEdit = (function(image) {
				this.modal.load('imageEdit', this.lang.get('edit'), 0);
				this.image.buttonSave = this.modal.createActionButton(this.lang.get('save'));
				
				this.image.buttonSave.click((function() {
					this.image.update(image);
				}).bind(this));
				
				// set overlay values
				$('#redactor-image-link-source').val(image.attr('src'));
				$('#redactor-image-align').val(image.css('float'));
				
				this.modal.show();
			}).bind(this);
			
			// image.update
			this.image.update = (function(image) {
				this.image.hideResize();
				this.buffer.set();
				
				image.attr('src', $('#redactor-image-link-source').val());
				this.image.setFloating(image);
				
				this.modal.close();
				this.observe.images();
			}).bind(this);
		},
		
		/**
		 * Partially overwrites the 'insert' module.
		 * 
		 *  - fixes insertion in an empty editor w/o prior focus until the issue has been resolved by Imperavi
		 */
		insert: function() {
			var $isWebKit = ($.browser.webkit || document.documentElement.style.hasOwnProperty('WebkitAppearance') || window.hasOwnProperty('chrome'));
			
			var $focusEditor = (function() {
				var $html = this.$editor.html();
				if (this.utils.isEmpty($html)) {
					this.$editor.focus();
					
					this.caret.setEnd(this.$editor.children('p:eq(0)'));
				}
				else {
					if (document.activeElement !== this.$editor[0]) {
						this.$editor.focus();
						
						if (this.wmonkeypatch._range) {
							var $selection = window.getSelection();
							$selection.removeAllRanges();
							$selection.addRange(this.wmonkeypatch._range);
							
							this.wmonkeypatch._range = null;
						}
					}
				}
			}).bind(this);
			
			// work-around for WebKit inserting lame spans
			// bug report: https://code.google.com/p/chromium/issues/detail?id=335955
			// based upon the idea: http://www.neotericdesign.com/blog/2013/3/working-around-chrome-s-contenteditable-span-bug
			var $fixWebKit = (function() {
				this.$editor.find('span').each(function() {
					var $span = $(this);
					if ($span.data('verified') !== 'redactor') {
						var $helper = $('<b>helper</b>').insertBefore($span);
						
						$helper.after($span.contents());
						
						$helper.remove();
						$span.remove();
					}
				});
			}).bind(this);
			
			// insert.html
			var $mpHtml = this.insert.html;
			this.insert.html = (function(html, clean) {
				$focusEditor();
				
				$mpHtml.call(this, html, clean);
				
				if ($isWebKit) {
					setTimeout(function() {
						$fixWebKit();
					}, 10);
				}
			}).bind(this);
			
			// pasting in Safari is broken, try to avoid breaking everything and wait for Imperavi to address this bug
			if (navigator.userAgent.match(/safari/i)) {
				var $mpExecHtml = this.insert.execHtml;
				this.insert.execHtml = (function(html) {
					try {
						$mpExecHtml.call(this, html);
					}
					catch (e) {
						console.debug("[Redactor.wmonkeypatch] Suppressed error in Safari: " + e.message);
					}
				}).bind(this);
			}
		},
		
		/**
		 * Partially overwrites the 'keydown' module.
		 * 
		 *  - improve behavior in quotes
		 *  - allow indentation for lists only
		 */
		keydown: function() {
			this.keydown.enterWithinBlockquote = false;
			
			// keydown.onTab
			var $mpOnTab = this.keydown.onTab;
			this.keydown.onTab = (function(e, key) {
				var $block = this.selection.getBlock();
				
				if ($block && $block.tagName === 'LI') {
					return $mpOnTab.call(this, e, key);
				}
				
				return true;
			}).bind(this);
			
			// keydown.replaceDivToParagraph
			var $mpReplaceDivToParagraph = this.keydown.replaceDivToParagraph;
			this.keydown.replaceDivToParagraph = (function() {
				if (this.keydown.enterWithinBlockquote) {
					// do nothing and prevent replacement
					this.keydown.enterWithinBlockquote = false;
				}
				else {
					$mpReplaceDivToParagraph.call(this);
				}
			}).bind(this);
		},
		
		/**
		 * Partially overwrites the 'link' module.
		 * 
		 * - force consistent caret position upon link insert
		 */
		link: function() {
			// link.insert
			var $mpInsert = this.link.insert;
			this.link.insert = (function() {
				$mpInsert.call(this);
				
				this.selection.get();
				var $current = this.selection.getCurrent();
				if ($current.tagName === 'A') {
					this.caret.setAfter($current);
				}
			}).bind(this);
		},
		
		/**
		 * Partially overwrites the 'modal' module.
		 * 
		 *  - delegate modal creation and handling to $.ui.wcfDialog.
		 */
		modal: function() {
			// modal.dialog
			this.modal.dialog = null;
			
			// modal.addTemplate
			var $mpAddTemplate = this.modal.addTemplate;
			this.modal.addTemplate = (function(name, template) {
				// overrides the 'table' template
				if (name !== 'table') {
					$mpAddTemplate.call(this, name, template);
				}
			}).bind(this);
			
			// modal.build
			this.modal.build = function() { /* does nothing */ };
			
			// modal.load
			this.modal.load = (function(templateName, title, width) {
				this.modal.templateName = templateName;
				this.modal.title = title;
				
				this.modal.dialog = $('<div />').hide().appendTo(document.body);
				this.modal.dialog.html(this.modal.getTemplate(this.modal.templateName));
				
				this.$modalFooter = null;
			}).bind(this);
			
			// modal.show
			this.modal.show = (function() {
				this.modal.dialog.wcfDialog({
					onClose: $.proxy(this.modal.close, this),
					title: this.modal.title
				});
				
				// focus first input field
				this.modal.dialog.find('input:first').focus();
			}).bind(this);
			
			// modal.createButton
			var $mpCreateButton = this.modal.createButton;
			this.modal.createButton = (function(label, className) {
				if (this.$modalFooter === null) {
					this.$modalFooter = $('<div class="formSubmit" />').appendTo(this.modal.dialog);
					this.modal.dialog.addClass('dialogForm');
				}
				
				return $mpCreateButton.call(this, label, className);
			}).bind(this);
			
			// modal.close
			this.modal.close = (function() {
				this.modal.dialog.wcfDialog('close');
				this.modal.dialog.remove();
			}).bind(this);
			
			// modal.createCancelButton
			this.modal.createCancelButton = function() { return $(); };
			
			// modal.createDeleteButton
			this.modal.createDeleteButton = function() { return $(); };
		},
		
		/**
		 * Partially overwrites the 'observe' module.
		 * 
		 *  - handles custom button active states.
		 */
		observe: function() {
			var $toggleButtons = (function(parent, searchFor, buttonSelector, inverse, className, skipInSourceMode) {
				var $buttons = this.$toolbar.find(buttonSelector);
				if (parent && parent.closest(searchFor, this.$editor[0]).length != 0) {
					$buttons[(inverse ? 'removeClass' : 'addClass')](className);
				}
				else {
					if (skipInSourceMode && !this.opts.visual) {
						return;
					}
					
					$buttons[(inverse ? 'addClass' : 'removeClass')](className);
				}
			}).bind(this);
			
			// observe.buttons
			var $mpButtons = this.observe.buttons;
			this.observe.buttons = (function(e, btnName) {
				$mpButtons.call(this, e, btnName);
				
				var parent = this.selection.getParent();
				parent = (parent === false) ? null : $(parent);
				
				$toggleButtons(parent, 'ul, ol', 'a.re-indent, a.re-outdent', true, 'redactor-button-disabled');
				//$toggleButtons(parent, 'inline.inlineCode', 'a.re-__wcf_tt', false, 'redactor-act');
				$toggleButtons(parent, 'blockquote.quoteBox', 'a.re-__wcf_quote', false, 'redactor-button-disabled', true);
				$toggleButtons(parent, 'sub', 'a.re-subscript', false, 'redactor-act');
				$toggleButtons(parent, 'sup', 'a.re-superscript', false, 'redactor-act');
			}).bind(this);
			
			// observe.showTooltip
			var $mpShowTooltip = this.observe.showTooltip;
			this.observe.showTooltip = (function(e) {
				var $link = $(e.target);
				if (!$link.hasClass('redactorQuoteEdit')) {
					$mpShowTooltip.call(this, e);
				}
			}).bind(this);
		},
		
		/**
		 * Partially overwrites the 'paste' module.
		 * 
		 *  - prevent screwed up, pasted HTML from placing text nodes (and inline elements) in the editor's direct root 
		 */
		paste: function() {
			var $fixDOM = (function() {
				var $current = this.$editor[0].childNodes[0];
				var $nextSibling = $current;
				var $p = null;
				
				while ($nextSibling) {
					$current = $nextSibling;
					$nextSibling = $current.nextSibling;
					
					if ($current.nodeType === Element.ELEMENT_NODE) {
						if (this.reIsBlock.test($current.tagName)) {
							$p = null;
						}
						else {
							if ($p === null) {
								$p = $('<p />').insertBefore($current);
							}
							
							$p.append($current);
						}
					}
					else if ($current.nodeType === Element.TEXT_NODE) {
						if ($p === null) {
							$p = $('<p />').insertBefore($current);
						}
						
						$p.append($current);
					}
				}
			}).bind(this);
			
			// paste.insert
			var $mpInsert = this.paste.insert;
			this.paste.insert = (function(html) {
				$mpInsert.call(this, html);
				
				setTimeout($fixDOM, 20);
			}).bind(this);
		},
		
		/**
		 * Partially overwrites the 'utils' module.
		 * 
		 *  - prevent removing of empty paragraphs/divs
		 */
		utils: function() {
			this.utils.removeEmpty = function(i, s) { /* does nothing */ };
		},
		
		/**
		 * Rebuilds certain templates provided by Redactor to better integrate into WCF.
		 */
		rebuildTemplates: function() {
			// template: image
			this.opts.modal.image =
				'<fieldset id="redactor-modal-image-edit">'
					+ '<dl>'
						+ '<dt><label for="redactor-image-link-source">' + this.lang.get('link') + '</label></dt>'
						+ '<dd><input type="text" id="redactor-image-link-source" class="long"  /></dd>'
					+ '</dl>'
					+ '<dl>'
						+ '<dt><label for="redactor-image-align">' + this.opts.curLang.image_position + '</label></dt>'
						+ '<dd>'
							+ '<select id="redactor-image-align">'
								+ '<option value="none">' + WCF.Language.get('wcf.global.noSelection') + '</option>'
								+ '<option value="left">' + this.lang.get('left') + '</option>'
								+ '<option value="right">' + this.lang.get('right') + '</option>'
							+ '</select>'
						+ '</dd>'
					+ '</dl>'
				+ '</fieldset>';
			
			// template: imageEdit
			this.opts.modal.imageEdit = this.opts.modal.image;
			
			// template: link
			this.opts.modal.link =
				'<fieldset id="redactor-modal-link">'
					+ '<dl>'
						+ '<dt><label for="redactor-link-url" />URL</label></dt>' /* TODO: use a phrase instead of hardcoding it! */
						+ '<dd><input type="url" id="redactor-link-url" /></dd>'
					+ '</dl>'
					+ '<dl>'
						+ '<dt><label for="redactor-link-url-text">' + this.lang.get('text') + '</label></dt>'
						+ '<dd><input type="text" id="redactor-link-url-text" /></dd>'
					+ '</dl>'
				+ '</fieldset>';
			
			// template: quote
			this.opts.modal.quote =
				'<fieldset>'
					+ '<dl>'
						+ '<dt><label for="redactorQuoteAuthor">' + WCF.Language.get('wcf.bbcode.quote.edit.author') + '</label></dt>'
						+ '<dd><input type="text" id="redactorQuoteAuthor" class="long" /></dd>'
					+ '</dl>'
					+ '<dl>'
						+ '<dt><label for="redactorQuoteLink">' + WCF.Language.get('wcf.bbcode.quote.edit.link') + '</label></dt>'
						+ '<dd><input type="text" id="redactorQuoteLink" class="long" /></dd>'
					+ '</dl>'
				+ '</fieldset>';
			
			// template: table
			this.opts.modal.table =
				'<fieldset id="redactor-modal-table-insert">'
					+ '<dl>'
						+ '<dt><label for="redactor-table-rows">' + this.lang.get('rows') + '</label></dt>'
						+ '<dd><input type="number" size="5" value="2" min="1" id="redactor-table-rows" class="tiny" /></dd>'
					+ '</dl>'
					+ '<dl>'
						+ '<dt><label for="redactor-table-columns">' + this.lang.get('columns') + '</label></dt>'
						+ '<dd><input type="number" size="5" value="3" min="1" id="redactor-table-columns" class="tiny" /></dd>'
					+ '</dl>'
				+ '</fieldset>';
		},
		
		/**
		 * Resolves issues in Chrome / WebKit based browsers
		 * 
		 * - Explicitly set CSS values for <span> within the editor, prevents Chrome from inserting random <span> tags
		 */
		fixWebKit: function() {
			return;
			if (!$.browser.webkit && !document.documentElement.style.hasOwnProperty('WebkitAppearance') && !window.hasOwnProperty('chrome')) {
				return;
			}
			
			// get styles
			var $default = {
				fontSize: this.$editor.css('font-size'),
				lineHeight: this.$editor.css('line-height')
			};
			
			var $editorID = this.$editor.wcfIdentify();
			var $style = document.createElement('style');
			$style.type = 'text/css';
			$style.innerHTML = '#' + $editorID + ' span { font-size: ' + $default.fontSize + '; line-height: ' + $default.lineHeight + ' }';
			document.head.appendChild($style);
		}
	};
};
