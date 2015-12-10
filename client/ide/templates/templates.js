Template.ScreensBody.onCreated(function () {
		Session.set("templateListFilter", undefined)
	}
)

Template.ScreensHeader.events({
	'click li': function (e, tmpl) {
		var $target = $(e.target)
		var dataAt = $target.data('template-filter')
		var li = tmpl.find("ul li.current")

		$(li).removeClass("current")
		$target.addClass("current")

		Session.set("templateListFilter", dataAt)
	}
})

Template.ScreensBody.helpers({
	templatelist: function(){
		tlf = Session.get( "templateListFilter" )
		appId = Session.get( "currentAppId" )
		var templatesToReturn = null

		if ( tlf == "all" ) {
			templatesToReturn = { appId: { $ne: Meteor.settings.public.systemApp } }
		} else if ( tlf == "templates" || tlf == undefined ) {
			templatesToReturn = { isWidget: false, appId: appId }
		} else if ( tlf == "widgets" ) {
			templatesToReturn = { isWidget: true, appId: appId }
		} else if ( tlf == "inherited" ) {
			templatesToReturn = { appId: { $nin: [ appId, Meteor.settings.public.systemApp ] } }
		}
		return Screens.find( templatesToReturn , { sort: { lowercaseTitle: 1 } } )
	},
	isWidget: function(){
		return this.isWidget ? "icon-ts-checkmark" : ""
	},
	// widgetlist: function(){
	// 	wl =  Screens.find({  isWidget: true}, {sort: {title: 1}})
	// 	return wl;
	// },
	// widget: function(){
	// 	return( "aa" +this.isWidget)
	// }
});
