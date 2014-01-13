/*
Copyright (C) 2013 Typesafe, Inc <http://typesafe.com>
*/
require.config({
  baseUrl:  '/public',
  // hack for now due to problem loading plugin loaders from a plugin loader
  map: {
    '*': {
      'css': '../../webjars/require-css/0.0.7/css',
      'text': '../../webjars/requirejs-text/2.0.10/text'
    }
  },
  paths: {
    commons:  'commons',
    core:     'core',
    services: 'services',
    plugins:  'plugins',
    widgets:  'widgets'
  }
});

require([
  // Vendors
  '../../webjars/requirejs-text/2.0.10/text',
  '../../webjars/require-css/0.0.7/css',
  'webjars!jquery',
  'webjars!knockout',
  'commons/visibility'
],function() {
  if (!document[hidden]) {
    startApp()
  }
  else {
    document.addEventListener(visibilityChange, handleVisibilityChange, false)
  }
});

var handleVisibilityChange = function() {
  if (!document[hidden]) {
    startApp()
    document.removeEventListener(visibilityChange, handleVisibilityChange)
  }
}

var startApp = function() {
  require([
  'commons/streams',
  'widgets/fileselection/fileselection',
  'widgets/log/log',
  'webjars!knockout',
  'widgets/lists/templatelist'], function(streams, FileSelection, log, ko, TemplateList) {
    // Register handlers on the UI.
    $(function() {

      // App Model
      var model = function(){
        var self = this;

        self.filteredTemplates = ko.observableArray(templates);
        self.currentApp = ko.observable();
        self.currentAppId = ko.computed(function(){
          return !!self.currentApp()?self.currentApp().id:"";
        });
        self.browseAppLocation = ko.observable(false);
        self.browseAppLocation = ko.observable(false);

        self.chooseTemplate = function(app){
          self.currentApp(app)
        }
        self.closeTemplate = function(){
          self.currentApp("")
        }
        self.clearSearch = function(){
          filterInput.val("").trigger("keyup")[0].focus();
        }
        self.search = function(model,evt){
          value = evt.currentTarget.value.toLowerCase();
          self.filteredTemplates(templates.filter(function(o){
            return JSON.stringify(o).indexOf(value) >= 0
          }));
        }
        self.closeNewBrowser = function() {
          $("#newAppLocationBrowser").hide();
        }
      };

      // Bind everything
      ko.applyBindings(new model());

      // Some tasks are simpler to achive with jquery
      var filterInput = $("#filter input");
      $(document).on("click", ".tags li", function(e){
        filterInput.val(e.currentTarget.innerHTML).trigger("keyup");
      });



      // Create log widget before we start recording websocket events...
      var logs = new log.Log();
      logs.renderTo($('#loading-logs'));
      // Register webSocket error handler
      streams.subscribe({
        handler: function(event) {
          // TODO - Can we try to reconnect X times before failing?
          alert("Connection lost; you will need to reload the page or restart Activator");
        },
        filter: function(event) {
          return event.type == streams.WEB_SOCKET_CLOSED;
        }
      });

      function toggleWorking() {
        $('#working, #open, #new').toggle();
      }
      streams.subscribe(function(event) {
        // Handle all the remote events here...
        switch(event.response) {
          case 'Status':
            logs.info(event.info);
            break;
          case 'BadRequest':
            // TODO - Do better than an alert!
            alert('Unable to perform request: ' + event.errors.join(' \n'));
            toggleWorking();
            break;
          case 'RedirectToApplication':
            // NOTE - Comment this out if you want to debug showing logs!
            window.location.href = window.location.href.replace('home', 'app/'+event.appId+'/');
            break;
          default:
            // Now check for log events...
            if(event.event && event.event.type == 'LogEvent') {
              logs.event(event.event);
            } else {
              // TODO - Should we do something more useful with these?
              console.debug('Unhandled event: ', event)
            }
          break;
        }
      });
      // Save these lookups so we don't have to do them repeatedly.
      var appNameInput = $('#newappName');
      var appLocationInput = $('#newappLocation');
      var homeDir = appLocationInput.attr('placeholder');
      var appTemplateName = $('#newAppTemplateName');
      var showTemplatesLink = $('#showLink');
      var evilLocationStore = homeDir;
      function updateAppLocation(location) {
        if(location) {
          evilLocationStore = location;
          appLocationInput.val('');
        }
        var currentAppName = appNameInput.val() || appNameInput.attr('placeholder') || '';
        appLocationInput.attr('placeholder', evilLocationStore + '/' + currentAppName);
      }
      appNameInput.on('keyup', function() {
        checkFormReady();
        updateAppLocation();
      });
      // Helper method to rip out form values appropriately...
      // TODO - This probably belongs in util.
      function formToJson(form) {
        var data = $(form).serializeArray();
        var o = {}
        $.each(data, function() {
          if (o[this.name] !== undefined) {
            if (!o[this.name].push) {
              o[this.name] = [o[this.name]];
            }
            o[this.name].push(this.value || '');
          } else {
            o[this.name] = this.value || '';
          }
        });
        return o;
      };
      // Hook Submissions to send to the websocket.
      $('#new').on('submit', "#newApp", function(event) {
        event.preventDefault();

        // use the placeholder values, unless one was manually specified
        if(!appLocationInput.val())
          appLocationInput.val(appLocationInput.attr('placeholder'));
        if (!appNameInput.val())
          appNameInput.val(appNameInput.attr('placeholder'));

        // Now we find our sneaky saved template id.
        // var template = appTemplateName.attr('data-template-id');
        var msg = formToJson(event.currentTarget);
        msg.request = 'CreateNewApplication';
        streams.send(msg);
        toggleWorking();

        return false;
      });
      function toggleDirectoryBrowser() {
        $('#newAppForm, #newAppLocationBrowser').toggle();
      };
      function toggleAppBrowser() {
        $('#openAppForm, #openAppLocationBrowser').toggle();
      };
      function toggleSelectTemplateBrowser() {
        $('#homePage, #templatePage').toggle();
      };
      var fs = new FileSelection({
        title: "Select location for new application",
        initialDir: homeDir,
        selectText: 'Select this Folder',
        onSelect: function(file) {
          // Update our store...
          $("#newAppLocationBrowser .close").trigger("click");
          $("#newappLocation").val(file +"/"+ $("#appName").val());
        },
        onCancel: function() {
          toggleDirectoryBrowser();
        },
        dom: '#newAppLocationBrowser .list'
      });
      var openFs = new FileSelection({
        selectText: 'Open this Project',
        initialDir: homeDir,
        onCancel: function() {
          toggleAppBrowser();
        },
        onSelect: function(file) {
          // TODO - Grey out the app while we wait for response.
          streams.send({
            request: 'OpenExistingApplication',
            location: file
          });
          toggleWorking();
        },
        dom: '#openAppLocationBrowser'
      });

      // Register fancy radio button controls.
      $('#new').on('click', 'li.template', function(event) {
        var template = {
            name: $('input', this).attr('data-snap-name-ref'),
            id: $('input', this).attr('value')
        }
        // TODO - Remove this bit here
        $('input:radio', this).prop('checked',true);
      })
      .on('click', '#browseAppLocation', function(event) {
        event.preventDefault();
        toggleDirectoryBrowser();
      });
      $('#open').on('click', '#openButton', function(event) {
        event.preventDefault();
        $('#openButton').toggleClass("opened");
        toggleAppBrowser();
      });

      // TODO - Figure out what to do when selecting a new template is displayed
      showTemplatesLink.on('click', function(event) {
        event.preventDefault();
        toggleSelectTemplateBrowser();
      });

      var showTemplateWidget = new TemplateList({
        onTemplateSelected: function(template) {
          toggleSelectTemplateBrowser();
          // Telegate to generic "select template" method.
        }
      });
      showTemplateWidget.renderTo('#templatePage');
      window.showTemplateWidget = showTemplateWidget;

      // TODO - Register file selection widget...
      // Register fancy click and open app buttons
      $('#open').on('click', 'li.recentApp', function(event) {
        var url = $('a', this).attr('href');
        // TODO - Better way to do this?
        window.location.href = url;
      })

    });
  })
}
