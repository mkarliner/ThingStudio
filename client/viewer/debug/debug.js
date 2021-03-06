Template.DebugBody.events({
	'click .tab': function ( e, tmpl ) {
		var tabs = tmpl.findAll( '.tab a' )
		$( tabs ).removeClass( 'active' )
		var newTab = e.target
		$thisTab = $( newTab )
		$thisTab.addClass( 'active' );
		thisTabBlockID = $thisTab.attr( 'href' )
		$( ".debug-page > div" ).css( { "display" : "none" } )
		$( ".debug-page " + thisTabBlockID ).css( { "display" : "block" } )
	}
})

Template.DebugSubscribe.events({
	'click .feed-items li': function ( e, tmpl ) {
		toggleDebugFeedDetails( e, tmpl );
	}
})

Template.DebugPublish.events({
	'click .feed-items li': function ( e, tmpl ) {
		toggleDebugFeedDetails( e, tmpl );
	}
})

Template.DebugSubscribe.helpers({
	messages: function() {
		return Messages.find( {} );
	},
	payload: function() {
		try {
			jstr = JSON.stringify( this.payload, null, 2 );
			return jstr;
		}
		catch(err){
			return err + " " + this
		}
	},
	showSubDebugSing: function() {
		if ( Session.get( "showFeedDebugDetails" ) == true ) {
			return 'expanded';
		} else {
			return 'collapsed';
		}
	},
	lastSeen: function() {
		return moment( this.timestamp ).format( 'lll' )
	}
});

Template.DebugPublish.helpers({
	outbox: function() {
		return Outbox.find( {} );
	},
	payload: function() {
		try {
			jstr = JSON.stringify( this.payload, null, 2 );
			return jstr;
		}
		catch(err){
			return err + " " + this
		}
	},
	showSubDebugSing: function() {
		if ( Session.get( "showFeedDebugDetails" ) == true ) {
			return 'expanded';
		} else {
			return 'collapsed';
		}
	},
	lastSeen: function() {
		return moment( this.timestamp ).format( 'lll' )
	}
});

Template.DebugRuntime.events({
	'click .runtime-clear': function( e, tmpl ) {
		e.preventDefault();
		RuntimeErrors.remove( {} )
	}
})

Template.DebugRuntime.helpers({
	runTimeErrorLog: function() {
		return RuntimeErrors.find()
	}
})
