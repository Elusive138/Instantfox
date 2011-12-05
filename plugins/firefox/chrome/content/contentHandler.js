InstantFox.contentHandlers = {
	"__default__":{
		isSame: function(q, url2go){
			return q.query && q.preloadURL && url2go.toLowerCase() == q.preloadURL.toLowerCase()
		}
	},
	"google":{
		isSame: function(q, url2go){
			if (!q.query || !q.preloadURL)
				return false
			if (url2go.toLowerCase() == q.preloadURL.toLowerCase())
				return true

			var m1 = url2go.match(this.qRe), m2 = q.preloadURL.match(this.qRe)
			return m1 && m2 && m1[1].toLowerCase() == m2[1].toLowerCase()
		},
		transformURL: function(q, url2go) {
			try{
				var url = InstantFox.pageLoader.preview.contentDocument.location.href;
				dump("---", url, url2go, q.query)
				// 
				var gDomain = url.match(/https?:\/\/((www|encrypted)\.)?google.([a-z\.]*)[^#]*/i)
				if (!gDomain)
					return url2go
				var query = url2go.match(/#.*/)
				if (!query)
					return url2go					
				return gDomain[0] + query[0]
			}catch(e){
				Cu.reportError(e)
				return url2go
			}
		},
		onLoad: function(q){
			this.checkPreview(800)
		},
		// workaround for google bug
		qRe: /[&?#]q=([^&]*)/,
		checkPreview: function(delay){
			var q = InstantFoxModule.currentQuery
			if(!q)
				return

			var self = InstantFox.contentHandlers.google
			if(delay){
				if(self.timeout)
					clearTimeout(self.timeout)

				self.timeout = setTimeout(self.checkPreview, delay, 0)
				return
			}

			self.timeout = null

			var url = InstantFox.pageLoader.preview.contentDocument.location.href
			if (url == "about:blank")
				return;

			if (!self.isSame(q, url)) {
				Cu.reportError(url + "\n!=\n" + q.preloadURL)
				InstantFox.pageLoader.addPreview(q.preloadURL)
				self.checkPreview(800)
			}
		}
	}
}

InstantFox.pageLoader = {
	get isActive(){
		return this.preview && this.preview.parentNode
	},
	preview: null,
	previewIsActive: false,
    removePreview: function() {
		if(this.previewIsActive)
			this.previewIsActive = false
        if (this.preview != null && this.preview.parentNode) {
            this.preview.parentNode.removeChild(this.preview);
            this.removeProgressListener(this.preview);
        }
    },

    // Provide a way to replace the current tab with the preview	
    persistPreview: function(tab, inBackground) {
		if (!this.previewIsActive)
			return;
		gURLBar.blur()
		if(tab == 'new'){
			tab = gBrowser.selectedTab
			if(!isTabEmpty(tab)){
				gBrowser._lastRelatedTab = null
                var relatedToCurrent = Services.prefs.getBoolPref("browser.tabs.insertRelatedAfterCurrent")
				var tab = gBrowser.addTab('', {relatedToCurrent:relatedToCurrent, skipAnimation:true})
				gBrowser.selectedTab = tab;
			}
		}
		var browser = this.swapBrowsers(tab)
		browser.userTypedValue = null;

		// Move focus out of the preview to the tab's browser before removing it

		this.preview.blur();
        inBackground || browser.focus();
        this.removePreview();
	},
	// Mostly copied from mozillaLabs instantPreview
	swapBrowsers: function(tab) {
    	var origin = this.preview;

        // Mostly copied from tabbrowser.xml swapBrowsersAndCloseOther
        var gBrowser = window.gBrowser;
		var targetTab = tab || gBrowser.selectedTab;
        var targetBrowser = targetTab.linkedBrowser;
        targetBrowser.stop();

        // Unhook progress listener
        var targetPos = targetTab._tPos;
		var filter = gBrowser.mTabFilters[targetPos];
		targetBrowser.webProgress.removeProgressListener(filter);
		var tabListener = gBrowser.mTabListeners[targetPos]
        filter.removeProgressListener(tabListener);
		tabListener.destroy();
        var tabListenerBlank = tabListener.mBlank;

        var openPage = gBrowser._placesAutocomplete;

        // Restore current registered open URI.
        if (targetBrowser.registeredOpenURI) {
            openPage.unregisterOpenPage(targetBrowser.registeredOpenURI);
            delete targetBrowser.registeredOpenURI;
        }
        openPage.registerOpenPage(origin.currentURI);
        targetBrowser.registeredOpenURI = origin.currentURI;

        // Save the last history entry from the preview if it has loaded
        var history = origin.sessionHistory.QueryInterface(Ci.nsISHistoryInternal);
        var entry;
        if (history.count > 0) {
            entry = history.getEntryAtIndex(history.index, false);
            history.PurgeHistory(history.count);
        }

        // Copy over the history from the current tab if it's not empty
        var origHistory = targetBrowser.sessionHistory;
        for (var i = 0; i <= origHistory.index; i++) {
            var origEntry = origHistory.getEntryAtIndex(i, false);
            if (origEntry.URI.spec != "about:blank") history.addEntry(origEntry, true);
        }

        // Add the last entry from the preview; in-progress preview will add itself
        if (entry != null)
			history.addEntry(entry, true);

        // Swap the docshells then fix up various properties
        targetBrowser.swapDocShells(origin);
        targetBrowser.attachFormFill();
        gBrowser.setTabTitle(targetTab);
        gBrowser.updateCurrentBrowser(true);
        gBrowser.useDefaultIcon(targetTab);
        gURLBar.value = (targetBrowser.currentURI.spec != "about:blank") ? targetBrowser.currentURI.spec : origin.getAttribute("src");

        // Restore the progress listener
        tabListener = gBrowser.mTabProgressListener(targetTab, targetBrowser, tabListenerBlank);
        gBrowser.mTabListeners[targetPos] = tabListener;
        filter.addProgressListener(tabListener, Ci.nsIWebProgress.NOTIFY_ALL);
        targetBrowser.webProgress.addProgressListener(filter, Ci.nsIWebProgress.NOTIFY_ALL);

		// restore history
		// preview.docShell.useGlobalHistory = true

		return targetBrowser
    },

	onfocus: function(e){
		this.persistPreview(InstantFoxModule.openSearchInNewTab?"new":null)
	},
	onTitleChanged: function(e){
		//dump(e.target.title)
		if(e.target == InstantFox.pageLoader.preview.contentDocument)
			InstantFox.pageLoader.label.value = e.target.title;
		e.stopPropagation()
	},

    addPreview: function(url) {
        // Only auto-load some types of uris
        //let url = result.getAttribute("url");
        /* if (url.search(/^(data|ftp|https?):/) == -1) {
            this.removePreview();
            return;
        } */
		let preview = this.preview
		let browser = window.gBrowser;
        // Create the preview if it's missing
        if (preview == null) {
            preview = window.document.createElement("browser");
            preview.setAttribute("type", "content");

            // Copy some inherit properties of normal tabbrowsers
            preview.setAttribute("autocompletepopup", browser.getAttribute("autocompletepopup"));
            preview.setAttribute("contextmenu", browser.getAttribute("contentcontextmenu"));
            preview.setAttribute("tooltip", browser.getAttribute("contenttooltip"));

            // Prevent title changes from showing during a preview
            preview.addEventListener("DOMTitleChanged", this.onTitleChanged, true);

            // The user clicking or tabbinb to the content should indicate persist
            preview.addEventListener("focus", this.onfocus.bind(this), true);
			this.preview = preview
        }

        // Move the preview to the current tab if switched
        let selectedStack = browser.selectedBrowser.parentNode;
        if (selectedStack != preview.parentNode){
			selectedStack.appendChild(preview);
			this.addProgressListener(preview)

			// set urlbaricon
			// todo: handle this elsewhere
			PageProxySetIcon('chrome://instantfox/content/skin/button-logo.png')
			gIdentityHandler.setMode(gIdentityHandler.IDENTITY_MODE_UNKNOWN)
		}
		this.previewIsActive = true
		// disable history
		// preview.docShell.useGlobalHistory = false


        // Load the url i
        preview.webNavigation.loadURI(url, nsIWebNavigation.LOAD_FLAGS_CHARSET_CHANGE, null, null, null);
    },

	//
	addProgressListener: function(browser) {
        // Listen for webpage loads
		if(!this.a){
			//InstantFox.pageLoader.preview.addProgressListener(this);
			this.a = true
		}

		if(!this.image){
			var image = window.document.createElement("image");
			image.setAttribute('src', 'chrome://instantfox/content/skin/ajax-loader.gif')

			var imagebox = window.document.createElement("vbox");
			imagebox.appendChild(image)
			imagebox.setAttribute('align', 'center')

			var box = window.document.createElement("hbox");
			box.setAttribute('bottom',0)
			box.setAttribute('pack', 'center')
			box.setAttribute('align', 'center')

			var label = window.document.createElement("label");
			label.setAttribute('value','debug')

			box.appendChild(label)
			box.appendChild(imagebox)

			this.label = label
			this.image = image
			this.box = box

			label.style.background = 'white'
			label.style.color = 'black'
			box.style.pointerEvents = 'none'
			box.style.opacity = '0.7'
			box.style.width = '100%'

		}

		browser.parentNode.appendChild(this.box)
    },

    removeProgressListener: function(browser) {
		this.box.parentNode.removeChild(this.box);
    },
};

