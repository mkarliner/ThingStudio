Template.SingleWidgetBody.onRendered(function() {
	$('ul.tabs').tabs();
	$('.collapsible').collapsible({
		accordion : false // A setting that changes the collapsible behavior to expandable instead of the default accordion style
	});
});

Template.SingleWidgetBody.helpers({
	currentScreen: function() {
		scr =  Screens.findOne({_id: this.baseScreen})
		scn = scr;
		//console.log("HTML: ", scn);
		if(scn) {
			//console.log("HTML: ", scn.html);
			delete Template[scn.title];
			compileTemplate(scn.title, scn.html, scn.js);
			return scn.title;
		} else {
			return "NoScreen";
		}
	},
	html: function() {
		return Screens.findOne({_id: this.baseScreen}).html;
	},
	js: function() {
		return Screens.findOne({_id: this.baseScreen}).js;
	},
	mandatory: function() {
		// return Widgets.findOne({_id: this.})
		if (this.required)
			return 'icon-ts-checkmark'
	},
	dummyData: function(){
		dd = {}
		return dd; // !!!!!!!!!!!
		if(this.parameters){
			for(var p=0; p < this.parameters.length; p++){
				dd[this.parameters[p].title] = this.parameters[p].dummyValue;
			}
		}
		return dd;
	},
	webComponent: function(){
		return this.widgetType=="Web Component" ? true : false;
	}
});

Template.SingleWidgetBody.events({
	'click #download-widget': function(ev){
		console.log("clicked", this);
		wgt = this;
		scr = Screens.findOne({_id: wgt.baseScreen});
		dump = {widget: wgt, template: scr};
		delete dump.widget._id;
		delete dump.widget.baseScreen;
		delete dump.widget.appId;
		delete dump.widget.owner;
		delete dump.template._id;
		delete dump.template.appId;
		delete dump.template.owner;
		delete dump.template.updatedAt;
		json = JSON.stringify(dump, null, 4);

		blob = new Blob([json], {type: "application/json;charset=utf-8"});
		saveAs(blob, this.title+".json")
		ev.preventDefault();
	}
})
